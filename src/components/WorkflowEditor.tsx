/**
 * 可视化工作流编辑器组件
 * 支持拖拽LLM、MCP、输入、输出模块，连接节点，执行工作流
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Brain, Plug, FileText, ArrowRight, Save, Play, Trash2, 
  Plus, X, ChevronDown, ChevronUp, Loader, Settings, GitBranch, Maximize2, Minimize2, Terminal, Layout, Workflow as WorkflowIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DataVisualizer } from './visualization/DataVisualizer';
import { getLLMConfigs, LLMConfigFromDB, getLLMConfigApiKey } from '../services/llmApi';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { LLMClient } from '../services/llmClient';
import { mcpManager, MCPTool } from '../services/mcpClient';
import { 
  getWorkflows, getWorkflow, createWorkflow, updateWorkflow, deleteWorkflow, executeWorkflow,
  Workflow, WorkflowNode, WorkflowConnection, WorkflowConfig 
} from '../services/workflowApi';
import { executeTerminalCommand } from '../utils/terminalExecutor';

interface DraggingNode {
  id: string;
  type: 'llm' | 'input' | 'output' | 'workflow' | 'terminal';
  offsetX: number;
  offsetY: number;
}

interface ConnectingState {
  sourceNodeId: string | null;
  targetNodeId: string | null;
  tempEnd: { x: number; y: number } | null;
}

const WorkflowEditor: React.FC = () => {
  // 工作流状态
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState('');
  
  // 节点和连接
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [connections, setConnections] = useState<WorkflowConnection[]>([]);
  
  // 拖拽状态
  const [draggingNode, setDraggingNode] = useState<DraggingNode | null>(null);
  const [draggingFromPalette, setDraggingFromPalette] = useState<{ type: string; offsetX: number; offsetY: number } | null>(null);
  
  // 连接状态
  const [connecting, setConnecting] = useState<ConnectingState>({
    sourceNodeId: null,
    targetNodeId: null,
    tempEnd: null,
  });
  
  // 节点配置弹窗
  const [configuringNode, setConfiguringNode] = useState<WorkflowNode | null>(null);
  
  // 输入节点编辑状态
  const [editingInputNode, setEditingInputNode] = useState<string | null>(null);
  const [inputNodeValue, setInputNodeValue] = useState<Record<string, string>>({});
  
  // LLM和MCP配置
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [selectedLLMConfigId, setSelectedLLMConfigId] = useState<string | null>(null);
  
  // 执行状态
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecutingNodeId, setCurrentExecutingNodeId] = useState<string | null>(null); // 保留用于向后兼容
  const [executingNodeIds, setExecutingNodeIds] = useState<Set<string>>(new Set()); // 支持多个节点并发执行
  const [outputNodeResult, setOutputNodeResult] = useState<Record<string, string>>({});
  // 输出框放大状态
  const [expandedOutputNodeId, setExpandedOutputNodeId] = useState<string | null>(null);
  // 节点执行耗时（用于在节点上显示）
  const [nodeDurations, setNodeDurations] = useState<Record<string, number>>({});
  const [executionLogs, setExecutionLogs] = useState<Array<{
    step: number;
    nodeType: string;
    nodeId: string;
    message: string;
    status: 'running' | 'success' | 'error';
    duration?: number;
    timestamp: number;
    isCodeLog?: boolean; // 区分代码日志和节点日志
  }>>([]);
  
  // 节点输入和输出缓存（用于从指定节点重新开始执行）
  const [nodeInputCache, setNodeInputCache] = useState<Record<string, string>>({});
  const [nodeOutputCache, setNodeOutputCache] = useState<Record<string, string>>({});
  
  // 画布引用
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 3000, height: 3000 });
  
  // 深色模式检测
  const [isDarkMode, setIsDarkMode] = useState(() => 
    document.documentElement.classList.contains('dark')
  );
  
  // 监听深色模式变化
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          setIsDarkMode(document.documentElement.classList.contains('dark'));
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);
  
  // 画布拖动状态
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // 执行日志面板拖拽状态
  const [isDraggingLogPanel, setIsDraggingLogPanel] = useState(false);
  const [logPanelPosition, setLogPanelPosition] = useState({ x: 16, y: window.innerHeight - 416 });
  const [logPanelDragStart, setLogPanelDragStart] = useState({ x: 0, y: 0 });
  
  // 窗口大小改变时调整日志面板位置
  useEffect(() => {
    const handleResize = () => {
      setLogPanelPosition(prev => ({
        x: prev.x,
        y: Math.min(prev.y, window.innerHeight - 416),
      }));
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // 选中的节点（用于显示详细日志）
  const [selectedLogNodeId, setSelectedLogNodeId] = useState<string | null>(null);
  // 节点日志展开/折叠状态
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  
  // 可视化节点尺寸状态
  const [visualizationNodeSizes, setVisualizationNodeSizes] = useState<Record<string, { width: number; height: number }>>({});
  // 正在调整大小的可视化节点
  const [resizingVisualization, setResizingVisualization] = useState<{ nodeId: string; startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);

  // 处理可视化节点调整大小
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (resizingVisualization) {
        e.preventDefault();
        const deltaX = e.clientX - resizingVisualization.startX;
        const deltaY = e.clientY - resizingVisualization.startY;
        
        setVisualizationNodeSizes(prev => ({
          ...prev,
          [resizingVisualization.nodeId]: {
            width: Math.max(300, resizingVisualization.startWidth + deltaX), // Min width 300
            height: Math.max(200, resizingVisualization.startHeight + deltaY) // Min height 200
          }
        }));
      }
    };

    const handleMouseUp = () => {
      setResizingVisualization(null);
    };

    if (resizingVisualization) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [resizingVisualization]);

  // 自动选中和展开当前执行的节点
  useEffect(() => {
    // 如果有正在执行的节点，选择第一个
    if (executingNodeIds.size > 0) {
      const firstExecutingId = Array.from(executingNodeIds)[0];
      setSelectedLogNodeId(firstExecutingId);
      setExpandedNodes(prev => {
        const newSet = new Set(prev);
        // 展开所有正在执行的节点
        executingNodeIds.forEach(nodeId => newSet.add(nodeId));
        // 折叠其他已完成的节点（只保留正在执行的节点展开）
        // 获取所有已完成的节点（状态为success或error，且不是正在执行的节点）
        const completedNodes = executionLogs
          .filter(log =>
            !log.isCodeLog &&
            !executingNodeIds.has(log.nodeId) &&
            log.nodeId !== 'start' &&
            log.nodeId !== 'complete' &&
            log.nodeId !== 'error' &&
            (log.status === 'success' || log.status === 'error')
          )
          .map(log => log.nodeId);
        // 移除已完成的节点（折叠它们）
        completedNodes.forEach(nodeId => newSet.delete(nodeId));
        return newSet;
      });
    } else if (currentExecutingNodeId) {
      setSelectedLogNodeId(currentExecutingNodeId);
      setExpandedNodes(prev => {
        const newSet = new Set(prev);
        // 展开当前执行的节点
        newSet.add(currentExecutingNodeId);
        // 折叠其他已完成的节点（只保留当前执行的节点展开）
        // 获取所有已完成的节点（状态为success或error，且不是当前执行的节点）
        const completedNodes = executionLogs
          .filter(log =>
            !log.isCodeLog &&
            log.nodeId !== currentExecutingNodeId &&
            log.nodeId !== 'start' &&
            log.nodeId !== 'complete' &&
            log.nodeId !== 'error' &&
            (log.status === 'success' || log.status === 'error')
          )
          .map(log => log.nodeId);
        // 移除已完成的节点（折叠它们）
        completedNodes.forEach(nodeId => newSet.delete(nodeId));
        return newSet;
      });
    }
  }, [currentExecutingNodeId, executingNodeIds, executionLogs]);
  
  // 节点尺寸映射（用于动态计算光谱边框）
  const [nodeSizes, setNodeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  
  // 加载数据
  useEffect(() => {
    loadWorkflows();
    loadLLMConfigs();
    loadMCPServers();
  }, []);
  
  // 调试：监听连接状态变化
  useEffect(() => {
    console.log('[连接状态] 当前连接状态:', connecting);
    console.log('[连接状态] 当前连接列表:', connections);
    console.log('[连接状态] 当前节点列表:', nodes.map(n => ({ id: n.id, type: n.type, pos: n.position })));
  }, [connecting, connections, nodes]);
  
  // 更新节点尺寸（用于动态计算光谱边框）
  useEffect(() => {
    const updateNodeSizes = () => {
      const newSizes: Record<string, { width: number; height: number }> = {};
      nodes.forEach(node => {
        const nodeElement = nodeRefs.current[node.id];
        if (nodeElement) {
          // 使用offsetWidth和offsetHeight获取实际尺寸
          // 考虑端口（左右各4px，位置在-2px）和删除按钮（5px，位置在-2px）
          // 边框padding是3px，所以需要额外空间：左右各6px（3px padding + 3px安全边距），上下各6px
          newSizes[node.id] = {
            width: nodeElement.offsetWidth + 12,  // 左右各6px（确保完全包裹端口）
            height: nodeElement.offsetHeight + 12, // 上下各6px（确保完全包裹删除按钮）
          };
        }
      });
      if (Object.keys(newSizes).length > 0) {
        setNodeSizes(prev => ({ ...prev, ...newSizes }));
      }
    };
    
    // 初始更新（延迟以确保DOM已渲染）
    const timer1 = setTimeout(updateNodeSizes, 50);
    
    // 当执行状态改变时也更新
    const timer2 = setTimeout(updateNodeSizes, 150);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [nodes, currentExecutingNodeId, executingNodeIds]);
  
  const loadWorkflows = async () => {
    try {
      const data = await getWorkflows();
      setWorkflows(data);
    } catch (error) {
      console.error('Failed to load workflows:', error);
    }
  };
  
  const loadLLMConfigs = async () => {
    try {
      const configs = await getLLMConfigs();
      setLlmConfigs(configs.filter(c => Boolean(c.enabled)));
      if (configs.length > 0) {
        setSelectedLLMConfigId(configs[0].config_id);
      }
    } catch (error) {
      console.error('Failed to load LLM configs:', error);
    }
  };
  
  const loadMCPServers = async () => {
    try {
      const servers = await getMCPServers();
      setMcpServers(servers.filter(s => s.enabled));
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
    }
  };
  
  // 加载工作流配置
  const handleLoadWorkflow = (workflowId: string) => {
    // 支持通过id或workflow_id查找
    const workflow = workflows.find(w => w.id === workflowId || w.workflow_id === workflowId);
    if (workflow) {
      console.log('[工作流] 加载工作流:', workflow);
      // 使用workflow_id作为selectedWorkflowId（如果存在），否则使用id
      const idToUse = workflow.workflow_id || workflow.id || workflowId;
      setSelectedWorkflowId(idToUse);
      setWorkflowName(workflow.name);
      const loadedNodes = workflow.config.nodes || [];
      const loadedConnections = workflow.config.connections || [];
      
      // 恢复输入节点的内容
      const inputValues: Record<string, string> = {};
      loadedNodes.forEach(node => {
        if (node.type === 'input' && node.data.inputValue) {
          inputValues[node.id] = node.data.inputValue;
        }
      });
      setInputNodeValue(inputValues);
      
      // 清空之前的输出结果
      setOutputNodeResult({});
      setExecutionLogs([]);
      
      setNodes(loadedNodes);
      setConnections(loadedConnections);
      
      console.log('[工作流] 加载的节点:', loadedNodes);
      console.log('[工作流] 加载的连接:', loadedConnections);
      console.log('[工作流] 加载的输入内容:', inputValues);
      console.log('[工作流] 使用的工作流ID:', idToUse);
    } else {
      console.warn('[工作流] 未找到工作流:', workflowId);
      alert('未找到指定的工作流');
    }
  };
  
  // 比较两个工作流配置是否相同（忽略顺序）
  const compareWorkflowConfigs = (config1: WorkflowConfig, config2: WorkflowConfig): boolean => {
    // 比较节点（按id排序后比较）
    const nodes1 = [...config1.nodes].sort((a, b) => a.id.localeCompare(b.id));
    const nodes2 = [...config2.nodes].sort((a, b) => a.id.localeCompare(b.id));
    
    if (nodes1.length !== nodes2.length) {
      return false;
    }
    
    for (let i = 0; i < nodes1.length; i++) {
      const n1 = nodes1[i];
      const n2 = nodes2[i];
      // 比较节点属性（忽略position的微小差异，只比较关键属性）
      if (n1.id !== n2.id ||
        n1.type !== n2.type ||
        JSON.stringify(n1.data) !== JSON.stringify(n2.data)) {
        return false;
      }
    }
    
    // 比较连接（按id排序后比较）
    const conn1 = [...config1.connections].sort((a, b) => a.id.localeCompare(b.id));
    const conn2 = [...config2.connections].sort((a, b) => a.id.localeCompare(b.id));
    
    if (conn1.length !== conn2.length) {
      return false;
    }
    
    for (let i = 0; i < conn1.length; i++) {
      const c1 = conn1[i];
      const c2 = conn2[i];
      if (c1.id !== c2.id ||
        c1.source !== c2.source ||
        c1.target !== c2.target) {
        return false;
      }
    }
    
    return true;
  };
  
  // 保存工作流
  const handleSaveWorkflow = async () => {
    if (!workflowName.trim()) {
      alert('请输入工作流名称');
      return;
    }
    
    try {
      // 保存输入节点的内容到节点数据中
      const nodesWithInput = nodes.map(node => {
        if (node.type === 'input' && inputNodeValue[node.id]) {
          return {
            ...node,
            data: {
              ...node.data,
              inputValue: inputNodeValue[node.id],
            },
          };
        }
        return node;
      });
      
      const config: WorkflowConfig = {
        nodes: nodesWithInput,
        connections
      };
      
      console.log('[工作流] 保存工作流配置:');
      console.log('[工作流] 节点数据:', nodesWithInput);
      console.log('[工作流] 连接数据:', connections);
      console.log('[工作流] 输入内容:', inputNodeValue);
      
      // 如果是更新已有工作流，先检查是否有变化
      if (selectedWorkflowId) {
        try {
          const existingWorkflow = await getWorkflow(selectedWorkflowId);
          
          // 比较配置是否相同
          if (existingWorkflow.name === workflowName &&
            compareWorkflowConfigs(existingWorkflow.config, config)) {
            alert('工作流没有变化');
            return;
          }
        } catch (error) {
          console.warn('无法获取现有工作流进行比较，直接保存:', error);
          // 如果获取失败，继续保存（可能是新创建的工作流）
        }
        
        // 有变化，直接保存覆盖
        await updateWorkflow(selectedWorkflowId, { name: workflowName, config });
      } else {
        // 新建工作流
        const result = await createWorkflow({ name: workflowName, config });
        // 使用workflow_id作为selectedWorkflowId
        setSelectedWorkflowId(result.workflow_id);
      }
      
      // 重新加载工作流列表，确保下拉框显示最新数据
      await loadWorkflows();
      
      // 如果保存成功，确保selectedWorkflowId在下拉框中正确显示
      // 由于loadWorkflows会更新workflows列表，下拉框会自动更新
      
      alert('工作流保存成功！');
    } catch (error) {
      console.error('Failed to save workflow:', error);
      alert('保存失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };
  
  // 新建工作流
  const handleNewWorkflow = () => {
    console.log('[工作流] 新建工作流');
    setSelectedWorkflowId(null);
    setWorkflowName('');
    setNodes([]);
    setConnections([]);
    setInputNodeValue({});
    setOutputNodeResult({});
  };
  
  // 删除连接
  const handleDeleteConnection = (connectionId: string) => {
    console.log('[工作流] 删除连接:', connectionId);
    setConnections(prev => prev.filter(c => c.id !== connectionId));
  };
  
  // 日志面板拖拽处理
  const handleLogPanelMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.log-panel-header')) {
      setIsDraggingLogPanel(true);
      setLogPanelDragStart({
        x: e.clientX - logPanelPosition.x,
        y: e.clientY - logPanelPosition.y,
      });
    }
  };
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLogPanel) {
        setLogPanelPosition({
          x: e.clientX - logPanelDragStart.x,
          y: e.clientY - logPanelDragStart.y,
        });
      }
    };
    
    const handleMouseUp = () => {
      setIsDraggingLogPanel(false);
    };
    
    if (isDraggingLogPanel) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDraggingLogPanel, logPanelDragStart]);
  
  // 从组件面板拖拽
  const handlePaletteDragStart = (e: React.DragEvent, type: 'llm' | 'input' | 'output' | 'workflow' | 'terminal') => {
    const rect = e.currentTarget.getBoundingClientRect();
    setDraggingFromPalette({
      type,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
  };
  
  // 在画布上放置节点
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingFromPalette || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - draggingFromPalette.offsetX;
    const y = e.clientY - rect.top - draggingFromPalette.offsetY;
    
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: draggingFromPalette.type as any,
      position: { x, y },
      data: {},
    };
    
    // 如果是LLM节点，自动设置默认LLM配置
    if (newNode.type === 'llm' && selectedLLMConfigId) {
      newNode.data.llmConfigId = selectedLLMConfigId;
    }
    
    // 如果是terminal节点，设置默认类型（cursor-agent）
    if (newNode.type === 'terminal') {
      newNode.data.terminalType = 'cursor-agent';
    }
    
    setNodes(prev => [...prev, newNode]);
    setDraggingFromPalette(null);
  };
  
  // 节点拖拽
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    // 如果点击的是配置按钮或删除按钮，不触发拖拽
    if ((e.target as HTMLElement).closest('.node-config-btn, .node-delete-btn')) {
      return;
    }
    
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDraggingNode({
      id: nodeId,
      type: node.type,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
  };
  
  // 开始连接（点击输出端口）
  const handleOutputPortClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      // 获取节点的实际高度来计算端口位置
      const nodeHeight = nodeSizes[node.id]?.height || 68;
      console.log('[连接] 开始连接，源节点:', nodeId, '节点类型:', node.type);
      setConnecting({
        sourceNodeId: nodeId,
        targetNodeId: null,
        tempEnd: {
          x: node.position.x + 112, // 节点右侧
          y: node.position.y + nodeHeight / 2 // 节点垂直中心
        },
      });
    }
  };
  
  // 完成连接（点击输入端口）
  const handleInputPortClick = (e: React.MouseEvent, targetNodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    
    console.log('[连接] 点击输入端口，目标节点:', targetNodeId, '当前连接状态:', connecting);
    
    if (connecting.sourceNodeId && connecting.sourceNodeId !== targetNodeId) {
      // 检查是否已存在连接
      const exists = connections.some(
        c => c.source === connecting.sourceNodeId && c.target === targetNodeId
      );
      
      console.log('[连接] 检查连接是否存在:', exists, '源节点:', connecting.sourceNodeId, '目标节点:', targetNodeId);
      
      if (!exists) {
        const newConnection: WorkflowConnection = {
          id: `conn-${Date.now()}`,
          source: connecting.sourceNodeId!,
          target: targetNodeId,
        };
        console.log('[连接] 创建新连接:', newConnection);
        setConnections(prev => {
          const updated = [...prev, newConnection];
          console.log('[连接] 更新后的连接列表:', updated);
          return updated;
        });
      } else {
        console.log('[连接] 连接已存在，跳过创建');
      }
    } else {
      console.log('[连接] 无法创建连接 - 源节点:', connecting.sourceNodeId, '目标节点:', targetNodeId);
    }
    
    setConnecting({ sourceNodeId: null, targetNodeId: null, tempEnd: null });
  };
  
  // 鼠标移动更新临时连接线
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (connecting.sourceNodeId && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const scrollLeft = canvasRef.current.scrollLeft;
        const scrollTop = canvasRef.current.scrollTop;
        setConnecting(prev => ({
          ...prev,
          tempEnd: {
            x: e.clientX - rect.left + scrollLeft,
            y: e.clientY - rect.top + scrollTop
          },
        }));
      }
    };
    
    if (connecting.sourceNodeId) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [connecting]);
  
  // 鼠标移动更新节点位置（优化：使用requestAnimationFrame提高响应速度）
  useEffect(() => {
    let animationFrameId: number | null = null;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingNode && canvasRef.current) {
        // 使用requestAnimationFrame优化性能
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
        }
        
        animationFrameId = requestAnimationFrame(() => {
          if (draggingNode && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const scrollLeft = canvasRef.current.scrollLeft || 0;
            const scrollTop = canvasRef.current.scrollTop || 0;
            const x = e.clientX - rect.left + scrollLeft - draggingNode.offsetX;
            const y = e.clientY - rect.top + scrollTop - draggingNode.offsetY;
        
            setNodes(prev => prev.map(node =>
              node.id === draggingNode.id
                ? { ...node, position: { x, y } }
                : node
            ));
          }
        });
      }
    };
    
    const handleMouseUp = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      setDraggingNode(null);
      // 不在这里取消连接，让用户点击输入端口或画布空白处来取消
    };
    
    if (draggingNode) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true });
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }
  }, [draggingNode]);
  
  // 配置节点
  const handleConfigureNode = (node: WorkflowNode) => {
    setConfiguringNode(node);
  };
  
  // 处理输入节点双击
  const handleInputNodeDoubleClick = (node: WorkflowNode) => {
    setEditingInputNode(node.id);
    setInputNodeValue(prev => ({
      ...prev,
      [node.id]: prev[node.id] || ''
    }));
  };
  
  // 保存输入节点内容
  const handleSaveInputNode = (nodeId: string) => {
    setEditingInputNode(null);
    // 输入内容已保存在 inputNodeValue 中
  };
  
  // 保存节点配置
  const handleSaveNodeConfig = (nodeId: string, config: Partial<WorkflowNode['data']>) => {
    setNodes(prev => prev.map(node =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, ...config } }
        : node
    ));
    setConfiguringNode(null);
  };
  
  // 执行工作流
  const handleExecuteWorkflow = async () => {
    console.log('='.repeat(80));
    console.log('🚀 [工作流执行] 开始执行工作流');
    console.log('='.repeat(80));
    
    setIsExecuting(true);
    setCurrentExecutingNodeId(null);
    setExecutingNodeIds(new Set()); // 清除所有执行节点ID
    setNodeDurations({}); // 清空节点耗时
    setExpandedNodes(new Set()); // 清空展开状态
    setSelectedLogNodeId(null); // 清空选中状态
    // 只保留开始节点日志，清空其他所有日志
    setExecutionLogs([{
      step: 0,
      nodeType: 'start',
      nodeId: 'start',
      message: '开始执行工作流',
      status: 'running',
      timestamp: Date.now(),
      isCodeLog: false,
    }]);
    
    // 添加代码日志（全局）
    const addCodeLog = (message: string, nodeId?: string) => {
      setExecutionLogs(prev => [...prev, {
        step: prev.length,
        nodeType: 'code',
        nodeId: nodeId || 'code',
        message,
        status: 'running' as const,
        timestamp: Date.now(),
        isCodeLog: true,
      }]);
    };
    
    addCodeLog('🚀 [工作流执行] 开始执行工作流');
    addCodeLog('='.repeat(60));
    
    try {
      // 找到输入节点
      const inputNode = nodes.find(n => n.type === 'input');
      if (!inputNode) {
        throw new Error('工作流中必须包含一个输入节点');
      }
      console.log('✅ [工作流执行] 找到输入节点:', inputNode.id);
      addCodeLog(`✅ [工作流执行] 找到输入节点: ${inputNode.id}`);
      
      // 找到所有输出节点（用于观察任意节点的输出）
      const outputNodes = nodes.filter(n => n.type === 'output');
      console.log('✅ [工作流执行] 找到输出节点:', outputNodes.map(n => n.id).join(', '));
      addCodeLog(`✅ [工作流执行] 找到 ${outputNodes.length} 个输出节点: ${outputNodes.map(n => n.id).join(', ')}`);
      
      // 找到真正的起点（没有输入连接的节点）
      const findStartNodes = () => {
        const nodesWithInput = new Set(connections.map(c => c.target));
        return nodes.filter(n => !nodesWithInput.has(n.id));
      };
      
      const startNodes = findStartNodes();
      console.log('🚀 [工作流执行] 起点节点:', startNodes.map(n => `${n.type}(${n.id})`).join(', '));
      addCodeLog(`🚀 [工作流执行] 起点节点: ${startNodes.map(n => `${n.type}(${n.id})`).join(', ')}`);
      
      // 如果没有起点节点，说明可能有循环，从输入节点开始
      const startNode = startNodes.length > 0 ? startNodes[0] : inputNode;
      
      // 构建执行图（支持多个下游节点）
      // 使用拓扑排序确保按依赖顺序执行
      const nodeOutputs: Map<string, string> = new Map(); // 存储每个节点的输出
      const nodeDependencies: Map<string, Set<string>> = new Map(); // 存储每个节点的依赖（上游节点）
      const nodeDependents: Map<string, string[]> = new Map(); // 存储每个节点的下游节点列表
      
      // 初始化依赖关系
      nodes.forEach(node => {
        nodeDependencies.set(node.id, new Set());
        nodeDependents.set(node.id, []);
      });
      
      // 构建依赖关系图
      connections.forEach(conn => {
        const sourceId = conn.source;
        const targetId = conn.target;
        
        // 添加依赖：target 依赖于 source
        const deps = nodeDependencies.get(targetId);
        if (deps) {
          deps.add(sourceId);
        }
        
        // 添加下游：source 的下游是 target
        const dependents = nodeDependents.get(sourceId);
        if (dependents) {
          dependents.push(targetId);
        }
      });
      
      // 拓扑排序：找到所有没有依赖的节点（起点）
      const readyNodes: string[] = [];
      const inDegree: Map<string, number> = new Map();
      
      nodes.forEach(node => {
        const deps = nodeDependencies.get(node.id) || new Set();
        inDegree.set(node.id, deps.size);
        if (deps.size === 0) {
          readyNodes.push(node.id);
        }
      });
      
      // 执行顺序列表（按层级分组，支持并发执行）
      const executeOrderGroups: string[][] = [];
      const executed = new Set<string>();
      
      // 拓扑排序执行，按层级分组
      while (readyNodes.length > 0) {
        // 当前层级的所有就绪节点（可以并发执行）
        const currentLevelNodes = [...readyNodes];
        readyNodes.length = 0; // 清空就绪队列
        
        // 记录当前层级的节点
        const levelGroup: string[] = [];
        currentLevelNodes.forEach(currentNodeId => {
          if (executed.has(currentNodeId)) return;
        
          executed.add(currentNodeId);
          levelGroup.push(currentNodeId);
        });
        
        if (levelGroup.length > 0) {
          executeOrderGroups.push(levelGroup);
        }
        
        // 处理所有已执行节点的下游节点
        currentLevelNodes.forEach(currentNodeId => {
          const dependents = nodeDependents.get(currentNodeId) || [];
          dependents.forEach(dependentId => {
            const currentInDegree = inDegree.get(dependentId) || 0;
            inDegree.set(dependentId, currentInDegree - 1);
          
            // 如果所有依赖都已执行，加入就绪队列
            if (inDegree.get(dependentId) === 0) {
              readyNodes.push(dependentId);
            }
          });
        });
      }
      
      // 将分组转换为扁平列表（用于日志显示）
      const executeOrder: string[] = executeOrderGroups.flat();
      
      console.log('📋 [工作流执行] 执行顺序（按层级分组，同层级并发执行）:');
      executeOrderGroups.forEach((group, levelIndex) => {
        const groupInfo = group.map(id => {
          const node = nodes.find(n => n.id === id);
          const dependents = nodeDependents.get(id) || [];
          const deps = nodeDependencies.get(id) || new Set();
          return `${node?.type}(${id})[依赖:${deps.size},下游:${dependents.length}]`;
        }).join(', ');
        console.log(`  层级 ${levelIndex + 1} (并发): [${groupInfo}]`);
      });
      addCodeLog(`📋 [工作流执行] 执行顺序: ${executeOrderGroups.length} 个层级，同层级节点将并发执行`);
      
      // 执行工作流
      // 检查输入节点是否有上游连接或用户输入
      const inputHasUpstream = connections.some(c => c.target === inputNode.id);
      const inputHasUserInput = inputNodeValue[inputNode.id];
      
      if (!inputHasUpstream && !inputHasUserInput) {
        throw new Error('请先在输入节点中填写内容（双击输入节点），或者连接上游节点');
      }
      
      console.log('📥 [工作流执行] 输入节点状态:', {
        hasUpstream: inputHasUpstream,
        hasUserInput: !!inputHasUserInput,
      });
      
      let stepCount = 0;
      
      // 执行单个节点的函数（用于并发执行）
      const executeNode = async (nodeId: string, levelIndex: number, levelSize: number, isConcurrent: boolean = false): Promise<void> => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;
        
        stepCount++;
        const stepStartTime = Date.now();
        
        // 确保在函数结束时归还MCP连接（无论成功还是失败）
        let mcpClientToReturn: any = null;
        let mcpServerIdToReturn: string | null = null;
        
        // 存储节点输出（用于传递给下游节点和输出节点）
        let nodeOutput = '';
        
        try {
          console.log(`\n${'─'.repeat(80)}`);
          console.log(`🔄 [层级 ${levelIndex + 1}/${executeOrderGroups.length}, 节点 ${stepCount}/${executeOrder.length}] 执行节点: ${node.type} (${nodeId})`);
          console.log(`${'─'.repeat(80)}`);
          
          // 将节点ID添加到执行集合（用于显示动态特效）
          setExecutingNodeIds(prev => new Set(prev).add(nodeId));
          // 同时设置单个节点ID（用于向后兼容，仅在单个节点时设置）
          if (levelSize === 1) {
            // 将节点ID添加到执行集合（用于显示动态特效）
            setExecutingNodeIds(prev => new Set(prev).add(nodeId));
            setCurrentExecutingNodeId(nodeId);
          }
          
          // 添加执行日志
          setExecutionLogs(prev => [...prev, {
            step: stepCount,
            nodeType: node.type,
            nodeId: nodeId,
            message: `执行 ${node.type} 节点`,
            status: 'running',
            timestamp: stepStartTime,
            isCodeLog: false,
          }]);
          
          // 添加代码日志（使用当前节点ID）
          const addNodeCodeLog = (message: string) => addCodeLog(message, nodeId);
          addCodeLog(`🔄 [层级 ${levelIndex + 1}/${executeOrderGroups.length}, 节点 ${stepCount}/${executeOrder.length}] 执行节点: ${node.type} (${nodeId})`);
          
          // 获取当前节点的输入（从上游节点的输出中获取）
          // 如果有多个上游节点，合并它们的输出
          const upstreamDeps = nodeDependencies.get(nodeId) || new Set();
          let currentInput = '';
          
          if (upstreamDeps.size > 0) {
            const upstreamOutputs: string[] = [];
            upstreamDeps.forEach(upstreamId => {
              const upstreamOutput = nodeOutputs.get(upstreamId);
              if (upstreamOutput) {
                upstreamOutputs.push(upstreamOutput);
                console.log(`📥 [节点 ${nodeId}] 获取上游节点 ${upstreamId} 的输出`);
                addNodeCodeLog(`📥 [节点] 获取上游节点 ${upstreamId} 的输出`);
              }
            });
            
            // 合并多个上游节点的输出
            if (upstreamOutputs.length > 1) {
              currentInput = upstreamOutputs.join('\n\n--- 来自不同上游 ---\n\n');
              console.log(`📥 [节点 ${nodeId}] 合并 ${upstreamOutputs.length} 个上游节点的输出`);
              addNodeCodeLog(`📥 [节点] 合并 ${upstreamOutputs.length} 个上游节点的输出`);
            } else if (upstreamOutputs.length === 1) {
              currentInput = upstreamOutputs[0];
            }
          }
          
          // 保存节点输入到缓存
          setNodeInputCache(prev => ({
            ...prev,
            [nodeId]: currentInput
          }));
        
          if (node.type === 'input') {
            console.log('📥 [输入节点] 开始处理...');
            addNodeCodeLog('📥 [输入节点] 开始处理...');
          
            // 1. 获取上游输出（已从 nodeOutputs 获取到 currentInput）
            const upstreamOutput = currentInput;
          
            // 2. 获取用户附加的输入
            const userInput = inputNodeValue[node.id] || '';
            if (userInput) {
              console.log('📥 [输入节点] 用户附加输入:', userInput.substring(0, 100) + (userInput.length > 100 ? '...' : ''));
              addNodeCodeLog(`📥 [输入节点] 用户附加输入长度: ${userInput.length} 字符`);
            }
          
            // 3. 合并上游输出和用户输入
            if (upstreamOutput && userInput) {
              nodeOutput = `${upstreamOutput}\n\n--- 附加说明 ---\n${userInput}`;
              console.log('📥 [输入节点] 合并模式: 上游输出 + 附加输入');
              addNodeCodeLog('📥 [输入节点] 合并模式: 上游输出 + 附加输入');
            } else if (upstreamOutput) {
              nodeOutput = upstreamOutput;
              console.log('📥 [输入节点] 仅使用上游输出');
              addNodeCodeLog('📥 [输入节点] 仅使用上游输出');
            } else if (userInput) {
              nodeOutput = userInput;
              console.log('📥 [输入节点] 仅使用用户输入');
              addNodeCodeLog('📥 [输入节点] 仅使用用户输入');
            }
          
            console.log('📥 [输入节点] 最终输出长度:', nodeOutput.length);
            addNodeCodeLog(`📥 [输入节点] 最终输出长度: ${nodeOutput.length} 字符`);
          
            const duration = Date.now() - stepStartTime;
            console.log(`⏱️ [输入节点] 耗时: ${duration}ms`);
            addNodeCodeLog(`⏱️ [输入节点] 耗时: ${duration}ms`);
          
            // 保存节点耗时
            setNodeDurations(prev => ({
              ...prev,
              [nodeId]: duration
            }));
          
            // 先更新日志状态，再清除执行节点ID（确保状态正确显示）
            setExecutionLogs(prev => {
              const newLogs = [...prev];
              const lastLog = newLogs[newLogs.length - 1];
              if (lastLog && lastLog.nodeId === nodeId) {
                newLogs[newLogs.length - 1] = {
                  ...lastLog,
                  status: 'success',
                  duration,
                  message: '输入节点执行完成',
                  timestamp: Date.now(), // 更新timestamp确保去重逻辑正确
                };
              }
              return newLogs;
            });
            // 保存节点输出
            nodeOutputs.set(nodeId, nodeOutput);
          
            // 保存节点输出到缓存
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          
            // 归还MCP连接到连接池
            const mcpClient = (node as any).__mcpClient;
            const mcpServerId = (node as any).__mcpServerId;
            if (mcpClient && mcpServerId) {
              console.log(`🔌 [LLM节点] 归还MCP连接到连接池: ${mcpServerId}`);
              mcpManager.returnToPool(mcpClient, mcpServerId);
              // 清理引用
              delete (node as any).__mcpClient;
              delete (node as any).__mcpServerId;
            }
          
            // 立即清除当前执行节点ID（状态判断逻辑会基于日志状态，不会因为延迟清除而显示错误状态）
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(nodeId);
              return newSet;
            });
            if (levelSize === 1) {
              setCurrentExecutingNodeId(null);
            }
          } else if (node.type === 'output') {
            console.log('📤 [输出节点] 类型: 输出节点');
            addNodeCodeLog('📤 [输出节点] 开始处理输出');
            console.log('📤 [输出节点] 接收到的内容:', currentInput);
            addNodeCodeLog(`📤 [输出节点] 接收到的内容长度: ${currentInput.length} 字符`);
          
            // 输出节点将接收到的内容作为输出（用于显示）
            nodeOutput = currentInput;
          
            // 保存到 outputNodeResult 用于显示
            setOutputNodeResult(prev => ({
              ...prev,
              [nodeId]: currentInput
            }));
          
            const duration = Date.now() - stepStartTime;
            console.log(`⏱️ [输出节点] 耗时: ${duration}ms`);
            addNodeCodeLog(`⏱️ [输出节点] 耗时: ${duration}ms`);
          
            // 保存节点耗时
            setNodeDurations(prev => ({
              ...prev,
              [nodeId]: duration
            }));
          
            // 先更新日志状态，再清除执行节点ID（确保状态正确显示）
            setExecutionLogs(prev => {
              const newLogs = [...prev];
              const lastLog = newLogs[newLogs.length - 1];
              if (lastLog && lastLog.nodeId === nodeId) {
                newLogs[newLogs.length - 1] = {
                  ...lastLog,
                  status: 'success',
                  duration,
                  message: '输出节点执行完成',
                  timestamp: Date.now(), // 更新timestamp确保去重逻辑正确
                };
              }
              return newLogs;
            });
          
            // 保存节点输出（虽然输出节点通常没有下游，但为了统一处理）
            nodeOutputs.set(nodeId, nodeOutput);
          
            // 保存节点输出到缓存
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          
            // 归还MCP连接到连接池
            const mcpClient = (node as any).__mcpClient;
            const mcpServerId = (node as any).__mcpServerId;
            if (mcpClient && mcpServerId) {
              console.log(`🔌 [LLM节点] 归还MCP连接到连接池: ${mcpServerId}`);
              mcpManager.returnToPool(mcpClient, mcpServerId);
              // 清理引用
              delete (node as any).__mcpClient;
              delete (node as any).__mcpServerId;
            }
          
            // 立即清除当前执行节点ID（状态判断逻辑会基于日志状态，不会因为延迟清除而显示错误状态）
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(nodeId);
              return newSet;
            });
            if (levelSize === 1) {
              setCurrentExecutingNodeId(null);
            }
          } else if (node.type === 'llm') {
            const llmConfigId = node.data.llmConfigId || selectedLLMConfigId;
            if (!llmConfigId) {
              throw new Error(`节点 ${nodeId} 未配置LLM模型`);
            }
          
            const llmConfig = llmConfigs.find(c => c.config_id === llmConfigId);
            if (!llmConfig) {
              throw new Error(`找不到LLM配置: ${llmConfigId}`);
            }
          
            console.log('🤖 [LLM节点] 模型:', llmConfig.name);
            addNodeCodeLog(`🤖 [LLM节点] 模型: ${llmConfig.name}`);
            console.log('🤖 [LLM节点] 提供商:', llmConfig.provider);
            addNodeCodeLog(`🤖 [LLM节点] 提供商: ${llmConfig.provider}`);
            console.log('🤖 [LLM节点] 输入内容:', currentInput);
            addNodeCodeLog(`🤖 [LLM节点] 输入内容长度: ${currentInput.length} 字符`);
          
            // 获取API密钥（Ollama 不需要 API key）
            const apiKey = await getLLMConfigApiKey(llmConfigId);
            if (llmConfig.provider !== 'ollama' && !apiKey) {
              throw new Error('API密钥未配置');
            }
            if (apiKey) {
              console.log('🔑 [LLM节点] API密钥已获取');
              addNodeCodeLog('🔑 [LLM节点] API密钥已获取');
            } else if (llmConfig.provider === 'ollama') {
              console.log('🔑 [LLM节点] Ollama 模型不需要 API 密钥');
              addNodeCodeLog('🔑 [LLM节点] Ollama 模型不需要 API 密钥');
            }
          
            // 收集MCP工具（只使用节点配置的MCP服务器，不遍历所有MCP）
            const allTools: MCPTool[] = [];
            if (node.data.mcpServerId) {
              const server = mcpServers.find(s => s.id === node.data.mcpServerId);
              if (server) {
                console.log(`🔌 [LLM节点] 使用MCP服务器: ${server.name} (ID: ${server.id})`);
                addNodeCodeLog(`🔌 [LLM节点] 使用MCP服务器: ${server.name} (ID: ${server.id})`);
                try {
                  const mcpServer = {
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    type: server.type as 'http-stream' | 'http-post' | 'stdio',
                    enabled: server.enabled,
                    description: server.description,
                    metadata: server.metadata,
                    ext: server.ext, // 传递扩展配置（包括 response_format, server_type 等）
                  };
                
                  // 使用连接池获取MCP连接（自动处理并发session隔离）
                  console.log(`🔌 [LLM节点] 从连接池获取MCP连接: ${server.name}`);
                  addNodeCodeLog(`🔌 [LLM节点] 从连接池获取MCP连接: ${server.name}`);
                  const mcpClient = await mcpManager.acquireConnection(mcpServer);
                  const tools = await mcpClient.listTools();
                  allTools.push(...tools);
                  const sessionId = mcpClient.getSessionId();
                  console.log(`🔌 [LLM节点] 成功加载 ${tools.length} 个MCP工具${sessionId ? ` (session: ${sessionId})` : ''}:`, tools.map(t => t.name).join(', '));
                  addNodeCodeLog(`🔌 [LLM节点] 成功加载 ${tools.length} 个MCP工具${sessionId ? ` (session: ${sessionId})` : ''}: ${tools.map(t => t.name).join(', ')}`);
                
                  // 存储客户端引用，用于后续归还到连接池
                  mcpClientToReturn = mcpClient;
                  mcpServerIdToReturn = server.id;
                } catch (error) {
                  console.warn(`⚠️ [LLM节点] 无法连接MCP服务器 ${server.name} (${server.id}):`, error);
                  addNodeCodeLog(`⚠️ [LLM节点] 无法连接MCP服务器 ${server.name}: ${error instanceof Error ? error.message : String(error)}`);
                }
              } else {
                console.warn(`⚠️ [LLM节点] 配置的MCP服务器ID (${node.data.mcpServerId}) 不存在或未启用`);
                addNodeCodeLog(`⚠️ [LLM节点] 配置的MCP服务器ID (${node.data.mcpServerId}) 不存在或未启用`);
              }
            } else {
              console.log('ℹ️ [LLM节点] 未配置MCP服务器，将不使用任何MCP工具');
              addNodeCodeLog('ℹ️ [LLM节点] 未配置MCP服务器，将不使用任何MCP工具');
            }
          
            // 创建LLM客户端
            const llmClient = new LLMClient({
              id: llmConfig.config_id,
              provider: llmConfig.provider,
              name: llmConfig.name,
              apiKey: apiKey,
              apiUrl: llmConfig.api_url,
              model: llmConfig.model,
              enabled: llmConfig.enabled,
              metadata: llmConfig.metadata,
            });
          
            // 构建系统提示词
            let systemPrompt = '你是一个智能工作流助手，可以帮助用户完成各种任务。';
          
            if (allTools.length > 0 && node.data.mcpServerId) {
              const mcpServerName = mcpServers.find(s => s.id === node.data.mcpServerId)?.name || '未知MCP服务器';
              systemPrompt += `\n\n【重要】本次请求配置的MCP服务器是：${mcpServerName} (ID: ${node.data.mcpServerId})\n\n你只能使用以下来自 ${mcpServerName} 的 MCP 工具来帮助用户完成任务，不要使用其他MCP服务器的工具：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
              console.log(`💬 [LLM节点] 系统提示词已明确指定MCP服务器: ${mcpServerName}`);
              addNodeCodeLog(`💬 [LLM节点] 系统提示词已明确指定MCP服务器: ${mcpServerName}`);
            } else if (allTools.length > 0) {
              systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
            } else {
              systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
            }
          
            console.log('💬 [LLM节点] 系统提示词已构建');
            addNodeCodeLog(`💬 [LLM节点] 系统提示词已构建 (${allTools.length} 个工具)`);
            console.log('⏳ [LLM节点] 正在调用LLM API...');
            addNodeCodeLog('⏳ [LLM节点] 正在调用LLM API...');
          
            // 设置工具流式输出回调，实时打印到日志
            llmClient.setOnToolStream((toolName, chunk) => {
              let displayText = '';
            
              if (chunk.type === 'parsed') {
                // 已解析的JSON数据
                displayText = JSON.stringify(chunk.content, null, 2).substring(0, 500);
              } else if (chunk.type === 'text') {
                // 纯文本内容
                displayText = chunk.content.substring(0, 500);
              } else if (chunk.content) {
                // 其他类型的内容
                displayText = typeof chunk.content === 'string'
                  ? chunk.content.substring(0, 500)
                  : JSON.stringify(chunk.content, null, 2).substring(0, 500);
              } else if (chunk.raw) {
                // 原始数据
                displayText = chunk.content.substring(0, 500);
              }
            
              if (displayText) {
                addNodeCodeLog(`📡 [MCP工具流式输出] ${toolName}:\n${displayText}${displayText.length >= 500 ? '\n...' : ''}`);
              }
            });
          
            // 执行LLM请求（只有在配置了MCP服务器时才传递工具列表）
            const llmStartTime = Date.now();
            const response = await llmClient.handleUserRequest(currentInput, systemPrompt, allTools.length > 0 ? allTools : undefined);
            const llmDuration = Date.now() - llmStartTime;
          
            console.log('✅ [LLM节点] LLM响应成功');
            addNodeCodeLog('✅ [LLM节点] LLM响应成功');
            console.log(`⏱️ [LLM节点] LLM API 耗时: ${llmDuration}ms`);
            addNodeCodeLog(`⏱️ [LLM节点] LLM API 耗时: ${llmDuration}ms`);
            console.log('📤 [LLM节点] 输出内容:', response.substring(0, 200) + (response.length > 200 ? '...' : ''));
            addNodeCodeLog(`📤 [LLM节点] 输出内容长度: ${response.length} 字符`);
          
            // 保存节点输出
            nodeOutput = response;
            nodeOutputs.set(nodeId, nodeOutput);
          
            // 保存节点输出到缓存
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          
            const duration = Date.now() - stepStartTime;
            console.log(`⏱️ [LLM节点] 总耗时: ${duration}ms`);
            addNodeCodeLog(`⏱️ [LLM节点] 总耗时: ${duration}ms`);
          
            // 保存节点耗时
            setNodeDurations(prev => ({
              ...prev,
              [nodeId]: duration
            }));
          
            // 先更新日志状态，再清除执行节点ID（确保状态正确显示）
            setExecutionLogs(prev => {
              const newLogs = [...prev];
              const lastLog = newLogs[newLogs.length - 1];
              if (lastLog && lastLog.nodeId === nodeId) {
                newLogs[newLogs.length - 1] = {
                  ...lastLog,
                  status: 'success',
                  duration,
                  message: `LLM节点执行完成 (API耗时: ${llmDuration}ms)`,
                  timestamp: Date.now(), // 更新timestamp确保去重逻辑正确
                };
              }
              return newLogs;
            });
            // 归还MCP连接到连接池
            const mcpClient = (node as any).__mcpClient;
            const mcpServerId = (node as any).__mcpServerId;
            if (mcpClient && mcpServerId) {
              console.log(`🔌 [LLM节点] 归还MCP连接到连接池: ${mcpServerId}`);
              mcpManager.returnToPool(mcpClient, mcpServerId);
              // 清理引用
              delete (node as any).__mcpClient;
              delete (node as any).__mcpServerId;
            }
          
            // 立即清除当前执行节点ID（状态判断逻辑会基于日志状态，不会因为延迟清除而显示错误状态）
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(nodeId);
              return newSet;
            });
            if (levelSize === 1) {
              setCurrentExecutingNodeId(null);
            }
          } else if (node.type === 'terminal') {
            const terminalType = node.data.terminalType || 'cursor-agent';
            console.log(`💻 [命令行节点] 类型: ${terminalType}`);
            addNodeCodeLog(`💻 [命令行节点] 开始处理，类型: ${terminalType}`);
          
            // 构建要执行的命令
            let command = '';
            if (terminalType === 'cursor-agent') {
              // cursor-agent节点：将输入作为任务发送到terminal
              command = `cursor-agent "${currentInput.replace(/"/g, '\\"')}"`;
              console.log('💻 [cursor-agent] 接收到的输入:', currentInput.substring(0, 100) + (currentInput.length > 100 ? '...' : ''));
              addNodeCodeLog(`💻 [cursor-agent] 接收到的输入长度: ${currentInput.length} 字符`);
              addNodeCodeLog(`💻 [cursor-agent] 执行命令: ${command}`);
            } else if (terminalType === 'python') {
              // Python类型：使用python执行
              command = `python -c "${currentInput.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`;
              console.log(`💻 [Python] 执行命令: ${command}`);
              addNodeCodeLog(`💻 [Python] 执行命令: ${command}`);
            } else if (terminalType === 'node') {
              // Node.js类型：使用node执行
              command = `node -e "${currentInput.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`;
              console.log(`💻 [Node.js] 执行命令: ${command}`);
              addNodeCodeLog(`💻 [Node.js] 执行命令: ${command}`);
            } else {
              // 其他terminal类型（bash/zsh/powershell/cmd）：直接执行输入的命令
              command = currentInput.trim();
              console.log(`💻 [${terminalType}] 执行命令: ${command}`);
              addNodeCodeLog(`💻 [${terminalType}] 执行命令: ${command}`);
            }
          
            // 发送命令到已有的terminal界面（参考下载youtube视频的操作方法）
            // 确保terminal是打开的
            window.dispatchEvent(new CustomEvent('open-terminal'));
          
            // 使用全局terminal执行器发送命令
            executeTerminalCommand(command);
          
            console.log('✅ [命令行节点] 命令已发送到terminal');
            addNodeCodeLog('✅ [命令行节点] 命令已发送到terminal，请在内嵌terminal中查看执行结果');
          
            // 命令已发送到terminal，输出提示信息
            nodeOutput = `命令已发送到terminal: ${command}\n\n请在内嵌terminal中查看执行结果。`;
          
            const duration = Date.now() - stepStartTime;
            console.log(`⏱️ [命令行节点] 耗时: ${duration}ms`);
            addNodeCodeLog(`⏱️ [命令行节点] 耗时: ${duration}ms`);
          
            // 保存节点耗时
            setNodeDurations(prev => ({
              ...prev,
              [nodeId]: duration
            }));
          
            // 先更新日志状态，再清除执行节点ID
            setExecutionLogs(prev => {
              const newLogs = [...prev];
              const lastLog = newLogs[newLogs.length - 1];
              if (lastLog && lastLog.nodeId === nodeId) {
                newLogs[newLogs.length - 1] = {
                  ...lastLog,
                  status: 'success',
                  duration,
                  message: '命令行节点执行完成',
                  timestamp: Date.now(),
                };
              }
              return newLogs;
            });
          
            // 保存节点输出
            nodeOutputs.set(nodeId, nodeOutput);
          
            // 保存节点输出到缓存
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          
            // 立即清除当前执行节点ID
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(nodeId);
              return newSet;
            });
            setCurrentExecutingNodeId(null);
          } else if (node.type === 'visualization') {
            console.log('🖼️ [展示节点] 类型: 展示组件');
            addNodeCodeLog('🖼️ [展示节点] 接收并展示数据');
            console.log('🖼️ [展示节点] 接收到的内容长度:', currentInput.length);
            addNodeCodeLog(`🖼️ [展示节点] 接收到的内容长度: ${currentInput.length} 字符`);

            // 展示节点将接收到的内容作为输出（用于显示和传递）
            nodeOutput = currentInput;

            // 保存到 outputNodeResult 用于显示 (复用输出节点的显示逻辑，或者专门的逻辑)
            setOutputNodeResult(prev => ({
              ...prev,
              [nodeId]: currentInput
            }));

            const duration = Date.now() - stepStartTime;
            console.log(`⏱️ [展示节点] 耗时: ${duration}ms`);
            addNodeCodeLog(`⏱️ [展示节点] 耗时: ${duration}ms`);

            // 保存节点耗时
            setNodeDurations(prev => ({
              ...prev,
              [nodeId]: duration
            }));

            // 先更新日志状态
            setExecutionLogs(prev => {
              const newLogs = [...prev];
              const lastLog = newLogs[newLogs.length - 1];
              if (lastLog && lastLog.nodeId === nodeId) {
                newLogs[newLogs.length - 1] = {
                  ...lastLog,
                  status: 'success',
                  duration,
                  message: '展示节点执行完成',
                  timestamp: Date.now(),
                };
              }
              return newLogs;
            });

            // 保存节点输出
            nodeOutputs.set(nodeId, nodeOutput);
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));

             // 立即清除当前执行节点ID
             setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(nodeId);
              return newSet;
            });
            if (levelSize === 1) {
              setCurrentExecutingNodeId(null);
            }
          } else if (node.type === 'workflow') {
            const workflowId = node.data.workflowId;
            if (!workflowId) {
              throw new Error(`节点 ${nodeId} 未配置工作流`);
            }
          
            const workflow = workflows.find(w => (w.id || w.workflow_id) === workflowId);
            if (!workflow) {
              throw new Error(`找不到工作流: ${workflowId}`);
            }
          
            console.log('🔄 [工作流节点] 执行子工作流:', workflow.name);
            addNodeCodeLog(`🔄 [工作流节点] 执行子工作流: ${workflow.name}`);
            console.log('🔄 [工作流节点] 输入内容长度:', currentInput.length);
            addNodeCodeLog(`🔄 [工作流节点] 输入内容长度: ${currentInput.length} 字符`);
          
            // 执行子工作流（黑盒执行）
            const workflowStartTime = Date.now();
            try {
              const result = await executeWorkflow(workflowId, currentInput);
              const workflowDuration = Date.now() - workflowStartTime;
            
              // 从结果中提取输出（根据后端返回的格式）
              const output = result.output || result.result || JSON.stringify(result);
              nodeOutput = typeof output === 'string' ? output : JSON.stringify(output);
            
              console.log('✅ [工作流节点] 子工作流执行成功');
              addNodeCodeLog('✅ [工作流节点] 子工作流执行成功');
              console.log(`⏱️ [工作流节点] 耗时: ${workflowDuration}ms`);
              addNodeCodeLog(`⏱️ [工作流节点] 耗时: ${workflowDuration}ms`);
              console.log('📤 [工作流节点] 输出内容长度:', nodeOutput.length);
              addNodeCodeLog(`📤 [工作流节点] 输出内容长度: ${nodeOutput.length} 字符`);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error('❌ [工作流节点] 子工作流执行失败:', errorMessage);
              addNodeCodeLog(`❌ [工作流节点] 子工作流执行失败: ${errorMessage}`);
              throw new Error(`子工作流执行失败: ${errorMessage}`);
            }
          
            // 保存节点输出
            nodeOutputs.set(nodeId, nodeOutput);
          
            // 保存节点输出到缓存
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          
            const duration = Date.now() - stepStartTime;
          
            // 保存节点耗时
            setNodeDurations(prev => ({
              ...prev,
              [nodeId]: duration
            }));
          
            // 先更新日志状态，再清除执行节点ID（确保状态正确显示）
            setExecutionLogs(prev => {
              const newLogs = [...prev];
              const lastLog = newLogs[newLogs.length - 1];
              if (lastLog && lastLog.nodeId === nodeId) {
                newLogs[newLogs.length - 1] = {
                  ...lastLog,
                  status: 'success',
                  duration,
                  message: '工作流节点执行完成',
                  timestamp: Date.now(), // 更新timestamp确保去重逻辑正确
                };
              }
              return newLogs;
            });
            // 归还MCP连接到连接池
            const mcpClient = (node as any).__mcpClient;
            const mcpServerId = (node as any).__mcpServerId;
            if (mcpClient && mcpServerId) {
              console.log(`🔌 [LLM节点] 归还MCP连接到连接池: ${mcpServerId}`);
              mcpManager.returnToPool(mcpClient, mcpServerId);
              // 清理引用
              delete (node as any).__mcpClient;
              delete (node as any).__mcpServerId;
            }
          
            // 立即清除当前执行节点ID（状态判断逻辑会基于日志状态，不会因为延迟清除而显示错误状态）
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              newSet.delete(nodeId);
              return newSet;
            });
            if (levelSize === 1) {
              setCurrentExecutingNodeId(null);
            }
          }
          
          // 检查是否有输出节点连接到当前节点，如果有则保存输出
          const connectedOutputNodes = connections
            .filter(conn => conn.source === nodeId)
            .map(conn => nodes.find(n => n.id === conn.target && n.type === 'output'))
            .filter((node): node is NonNullable<typeof node> => node !== undefined);
          
          if (connectedOutputNodes.length > 0 && nodeOutput) {
            connectedOutputNodes.forEach(outputNode => {
              setOutputNodeResult(prev => ({
                ...prev,
                [outputNode.id]: nodeOutput
              }));
              console.log(`✅ [工作流执行] 节点 ${nodeId} 的输出已保存到输出节点 ${outputNode.id}`);
              addCodeLog(`✅ [工作流执行] 节点 ${nodeId} 的输出已保存到输出节点 ${outputNode.id}`);
            });
          }
        } finally {
            // 无论成功还是失败，都要归还MCP连接到连接池
            if (mcpClientToReturn && mcpServerIdToReturn) {
              console.log(`🔌 [节点] 归还MCP连接到连接池: ${mcpServerIdToReturn}`);
              mcpManager.returnToPool(mcpClientToReturn, mcpServerIdToReturn);
            }
          }
        };
      
        // 按层级分组执行节点（同层级并发执行）
        for (let levelIndex = 0; levelIndex < executeOrderGroups.length; levelIndex++) {
          const levelGroup = executeOrderGroups[levelIndex];
        
          console.log(`\n${'═'.repeat(80)}`);
          console.log(`📊 [层级 ${levelIndex + 1}/${executeOrderGroups.length}] 开始执行 ${levelGroup.length} 个节点${levelGroup.length > 1 ? '（并发）' : ''}`);
          console.log(`${'═'.repeat(80)}`);
          addCodeLog(`📊 [层级 ${levelIndex + 1}/${executeOrderGroups.length}] 开始执行 ${levelGroup.length} 个节点${levelGroup.length > 1 ? '（并发）' : ''}`);
        
          if (levelGroup.length === 1) {
            // 单个节点，直接执行
            await executeNode(levelGroup[0], levelIndex, levelGroup.length);
          } else {
            // 多个节点，并发执行
            const levelStartTime = Date.now();
            setCurrentExecutingNodeId(null); // 清除单个节点ID，因为多个节点并发执行
          
            // 将所有节点ID添加到执行集合（在开始执行前就添加，确保UI立即显示）
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              levelGroup.forEach(id => newSet.add(id));
              return newSet;
            });
          
            // 并发执行所有节点（每个节点使用独立的MCP连接，避免资源竞争）
            await Promise.all(levelGroup.map(nodeId => executeNode(nodeId, levelIndex, levelGroup.length, true))); // 传入true表示并发执行
          
            // 执行完成后，清除所有节点ID
            setExecutingNodeIds(prev => {
              const newSet = new Set(prev);
              levelGroup.forEach(id => newSet.delete(id));
              return newSet;
            });
          
            const levelDuration = Date.now() - levelStartTime;
            console.log(`⏱️ [层级 ${levelIndex + 1}] 并发执行完成，总耗时: ${levelDuration}ms`);
            addCodeLog(`⏱️ [层级 ${levelIndex + 1}] 并发执行完成，总耗时: ${levelDuration}ms`);
          }
        }
      
        console.log('\n' + '='.repeat(80));
        console.log('🎉 [工作流执行] 工作流执行成功！');
        console.log('='.repeat(80));
        addCodeLog('='.repeat(60));
        addCodeLog('🎉 [工作流执行] 工作流执行成功！');
        addCodeLog('='.repeat(60));
      
        setExecutionLogs(prev => [...prev, {
          step: stepCount + 1,
          nodeType: 'complete',
          nodeId: 'complete',
          message: '工作流执行成功',
          status: 'success',
          timestamp: Date.now(),
          isCodeLog: false,
        }]);
      } catch (error) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ [工作流执行] 执行失败:', error);
        console.error('='.repeat(80));
      
        const errorMessage = error instanceof Error ? error.message : String(error);
        addCodeLog('='.repeat(60));
        addCodeLog(`❌ [工作流执行] 执行失败: ${errorMessage}`);
        addCodeLog('='.repeat(60));
      
        setExecutionLogs(prev => [...prev, {
          step: prev.length,
          nodeType: 'error',
          nodeId: 'error',
          message: `执行失败: ${errorMessage}`,
          status: 'error',
          timestamp: Date.now(),
          isCodeLog: false,
        }]);
      
        // 如果有输出节点，也显示错误信息
        const errorOutputNodes = nodes.filter(n => n.type === 'output');
        errorOutputNodes.forEach(outputNode => {
          setOutputNodeResult(prev => ({
            ...prev,
            [outputNode.id]: `❌ 执行失败: ${errorMessage}`
          }));
        });
      } finally {
        setIsExecuting(false);
        setCurrentExecutingNodeId(null);
        setExecutingNodeIds(new Set()); // 清除所有执行节点ID
        console.log('🏁 [工作流执行] 执行流程结束\n');
        addCodeLog('🏁 [工作流执行] 执行流程结束');
      }
    };
  
    // 从指定节点开始执行工作流
    const handleExecuteFromNode = async (startNodeId: string) => {
      const startNode = nodes.find(n => n.id === startNodeId);
      if (!startNode) {
        alert('未找到指定的节点');
        return;
      }
    
      // 检查是否有该节点的输入缓存
      const cachedInput = nodeInputCache[startNodeId];
    
      if (!cachedInput) {
        const confirmNoInput = window.confirm(
          `节点 "${startNode.type}" 没有输入缓存。是否无输入开始执行？\n\n这将从该节点开始执行后续流程，但该节点可能无法正常工作。`
        );
        if (!confirmNoInput) {
          return;
        }
      }
    
      console.log('='.repeat(80));
      console.log(`🚀 [节点执行] 从节点 ${startNode.type} (${startNodeId}) 开始执行`);
      console.log('='.repeat(80));
    
      setIsExecuting(true);
      setCurrentExecutingNodeId(null);
      setExecutingNodeIds(new Set()); // 清除所有执行节点ID
      setExecutionLogs([{
        step: 0,
        nodeType: 'start',
        nodeId: 'start',
        message: `从节点 ${startNode.type} 开始执行`,
        status: 'running',
        timestamp: Date.now(),
        isCodeLog: false,
      }]);
    
      const addCodeLog = (message: string) => {
        setExecutionLogs(prev => [...prev, {
          step: prev.length,
          nodeType: 'log',
          nodeId: 'log',
          message,
          status: 'success',
          timestamp: Date.now(),
          isCodeLog: true,
        }]);
      };
    
      addCodeLog(`🚀 [节点执行] 从节点 ${startNode.type} (${startNodeId}) 开始执行`);
      addCodeLog('='.repeat(60));
    
      try {
        // 构建从指定节点开始的执行路径
        const nodeOutputs: Map<string, string> = new Map();
        const nodeDependencies: Map<string, Set<string>> = new Map();
        const nodeDependents: Map<string, string[]> = new Map();
      
        // 初始化依赖关系
        nodes.forEach(node => {
          nodeDependencies.set(node.id, new Set());
          nodeDependents.set(node.id, []);
        });
      
        // 构建依赖关系图
        connections.forEach(conn => {
          const sourceId = conn.source;
          const targetId = conn.target;
        
          const deps = nodeDependencies.get(targetId);
          if (deps) {
            deps.add(sourceId);
          }
        
          const dependents = nodeDependents.get(sourceId);
          if (dependents) {
            dependents.push(targetId);
          }
        });
      
        // 如果有缓存的输入，使用缓存
        if (cachedInput) {
          nodeOutputs.set(startNodeId, cachedInput);
          console.log(`📦 [节点执行] 使用缓存的输入，长度: ${cachedInput.length} 字符`);
          addCodeLog(`📦 [节点执行] 使用缓存的输入，长度: ${cachedInput.length} 字符`);
        } else {
          // 如果没有缓存，尝试从上游节点获取输出
          const upstreamDeps = nodeDependencies.get(startNodeId) || new Set();
          if (upstreamDeps.size > 0) {
            const upstreamOutputs: string[] = [];
            upstreamDeps.forEach(upstreamId => {
              const upstreamOutput = nodeOutputCache[upstreamId];
              if (upstreamOutput) {
                upstreamOutputs.push(upstreamOutput);
                nodeOutputs.set(upstreamId, upstreamOutput);
              }
            });
          
            if (upstreamOutputs.length > 0) {
              const mergedInput = upstreamOutputs.length > 1
                ? upstreamOutputs.join('\n\n--- 来自不同上游 ---\n\n')
                : upstreamOutputs[0];
              nodeOutputs.set(startNodeId, mergedInput);
              console.log(`📦 [节点执行] 从上游节点获取输入，长度: ${mergedInput.length} 字符`);
              addCodeLog(`📦 [节点执行] 从上游节点获取输入，长度: ${mergedInput.length} 字符`);
            }
          }
        }
      
        // 使用BFS找到从startNodeId开始的所有可达节点
        const executeOrder: string[] = [];
        const visited = new Set<string>();
        const queue: string[] = [startNodeId];
      
        while (queue.length > 0) {
          const currentNodeId = queue.shift()!;
          if (visited.has(currentNodeId)) continue;
        
          visited.add(currentNodeId);
          executeOrder.push(currentNodeId);
        
          // 添加所有下游节点到队列
          const dependents = nodeDependents.get(currentNodeId) || [];
          dependents.forEach(dependentId => {
            if (!visited.has(dependentId)) {
              queue.push(dependentId);
            }
          });
        }
      
        console.log(`📋 [节点执行] 执行顺序: ${executeOrder.map(id => {
          const node = nodes.find(n => n.id === id);
          return `${node?.type}(${id})`;
        }).join(' -> ')}`);
        addCodeLog(`📋 [节点执行] 执行顺序: ${executeOrder.map(id => {
          const node = nodes.find(n => n.id === id);
          return `${node?.type}(${id})`;
        }).join(' -> ')}`);
      
        let stepCount = 0;
      
        // 执行节点（复用原有的执行逻辑，但简化一些）
        for (const nodeId of executeOrder) {
          const node = nodes.find(n => n.id === nodeId);
          if (!node) continue;
        
          stepCount++;
          const stepStartTime = Date.now();
        
          console.log(`\n${'─'.repeat(80)}`);
          console.log(`🔄 [步骤 ${stepCount}/${executeOrder.length}] 执行节点: ${node.type} (${nodeId})`);
          console.log(`${'─'.repeat(80)}`);
        
          // 将节点ID添加到执行集合（用于显示动态特效）
          setExecutingNodeIds(prev => new Set(prev).add(nodeId));
          setCurrentExecutingNodeId(nodeId);
        
          setExecutionLogs(prev => [...prev, {
            step: stepCount,
            nodeType: node.type,
            nodeId: nodeId,
            message: `执行 ${node.type} 节点`,
            status: 'running',
            timestamp: stepStartTime,
            isCodeLog: false,
          }]);
        
          const addNodeCodeLog = (message: string) => addCodeLog(message);
          addCodeLog(`🔄 [步骤 ${stepCount}/${executeOrder.length}] 执行节点: ${node.type} (${nodeId})`);
        
          // 获取当前节点的输入
          const upstreamDeps = nodeDependencies.get(nodeId) || new Set();
          let currentInput = '';
        
          if (upstreamDeps.size > 0) {
            const upstreamOutputs: string[] = [];
            upstreamDeps.forEach(upstreamId => {
              const upstreamOutput = nodeOutputs.get(upstreamId);
              if (upstreamOutput) {
                upstreamOutputs.push(upstreamOutput);
              }
            });
          
            if (upstreamOutputs.length > 1) {
              currentInput = upstreamOutputs.join('\n\n--- 来自不同上游 ---\n\n');
            } else if (upstreamOutputs.length === 1) {
              currentInput = upstreamOutputs[0];
            }
          } else if (nodeId === startNodeId && cachedInput) {
            // 如果是起始节点且有缓存，使用缓存
            currentInput = cachedInput;
          }
        
          // 保存节点输入到缓存
          setNodeInputCache(prev => ({
            ...prev,
            [nodeId]: currentInput
          }));
        
          let nodeOutput = '';
        
          // 执行节点（复用原有的执行逻辑）
          if (node.type === 'input') {
            const userInput = inputNodeValue[node.id] || '';
            if (currentInput && userInput) {
              nodeOutput = `${currentInput}\n\n--- 附加说明 ---\n${userInput}`;
            } else if (currentInput) {
              nodeOutput = currentInput;
            } else if (userInput) {
              nodeOutput = userInput;
            }
          
            nodeOutputs.set(nodeId, nodeOutput);
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          } else if (node.type === 'output') {
            nodeOutput = currentInput;
            nodeOutputs.set(nodeId, nodeOutput);
            setOutputNodeResult(prev => ({
              ...prev,
              [nodeId]: currentInput
            }));
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          } else if (node.type === 'terminal') {
            const terminalType = node.data.terminalType || 'cursor-agent';
            console.log(`💻 [命令行节点] 类型: ${terminalType}`);
            addNodeCodeLog(`💻 [命令行节点] 开始处理，类型: ${terminalType}`);
          
            // 构建要执行的命令
            let command = '';
            if (terminalType === 'cursor-agent') {
              command = `cursor-agent "${currentInput.replace(/"/g, '\\"')}"`;
              console.log('💻 [cursor-agent] 接收到的输入:', currentInput.substring(0, 100) + (currentInput.length > 100 ? '...' : ''));
              addNodeCodeLog(`💻 [cursor-agent] 接收到的输入长度: ${currentInput.length} 字符`);
              addNodeCodeLog(`💻 [cursor-agent] 执行命令: ${command}`);
            } else if (terminalType === 'python') {
              // Python类型：使用python执行
              command = `python -c "${currentInput.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`;
              console.log(`💻 [Python] 执行命令: ${command}`);
              addNodeCodeLog(`💻 [Python] 执行命令: ${command}`);
            } else if (terminalType === 'node') {
              // Node.js类型：使用node执行
              command = `node -e "${currentInput.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`;
              console.log(`💻 [Node.js] 执行命令: ${command}`);
              addNodeCodeLog(`💻 [Node.js] 执行命令: ${command}`);
            } else {
              // 其他terminal类型（bash/zsh/powershell/cmd）：直接执行输入的命令
              command = currentInput.trim();
              console.log(`💻 [${terminalType}] 执行命令: ${command}`);
              addNodeCodeLog(`💻 [${terminalType}] 执行命令: ${command}`);
            }
          
            // 发送命令到已有的terminal界面（参考下载youtube视频的操作方法）
            // 确保terminal是打开的
            window.dispatchEvent(new CustomEvent('open-terminal'));
          
            // 使用全局terminal执行器发送命令
            executeTerminalCommand(command);
          
            console.log('✅ [命令行节点] 命令已发送到terminal');
            addNodeCodeLog('✅ [命令行节点] 命令已发送到terminal，请在内嵌terminal中查看执行结果');
          
            // 命令已发送到terminal，输出提示信息
            nodeOutput = `命令已发送到terminal: ${command}\n\n请在内嵌terminal中查看执行结果。`;
          
            nodeOutputs.set(nodeId, nodeOutput);
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          } else if (node.type === 'visualization') {
             // 展示节点逻辑
             nodeOutput = currentInput;
             nodeOutputs.set(nodeId, nodeOutput);
             setOutputNodeResult(prev => ({
               ...prev,
               [nodeId]: currentInput
             }));
             setNodeOutputCache(prev => ({
               ...prev,
               [nodeId]: nodeOutput
             }));
             addNodeCodeLog('🖼️ [展示节点] 数据已更新');
          } else if (node.type === 'llm') {
            const llmConfigId = node.data.llmConfigId || selectedLLMConfigId;
            if (!llmConfigId) {
              throw new Error(`节点 ${nodeId} 未配置LLM模型`);
            }
          
            const llmConfig = llmConfigs.find(c => c.config_id === llmConfigId);
            if (!llmConfig) {
              throw new Error(`找不到LLM配置: ${llmConfigId}`);
            }
          
            const apiKey = await getLLMConfigApiKey(llmConfigId);
            if (!apiKey) {
              throw new Error('API密钥未配置');
            }
          
            // 收集MCP工具（只使用节点配置的MCP服务器，不遍历所有MCP）
            const allTools: MCPTool[] = [];
            if (node.data.mcpServerId) {
              const server = mcpServers.find(s => s.id === node.data.mcpServerId);
              if (server) {
                console.log(`🔌 [LLM节点] 使用MCP服务器: ${server.name} (ID: ${server.id})`);
                addNodeCodeLog(`🔌 [LLM节点] 使用MCP服务器: ${server.name} (ID: ${server.id})`);
                try {
                  // 检查是否已有连接
                  const existingClient = mcpManager.getClient(server.id);
                  if (existingClient && existingClient.isInitialized) {
                    // 已连接，直接获取工具列表（会使用缓存）
                    console.log(`🔌 [LLM节点] 使用现有连接: ${server.name}`);
                    addNodeCodeLog(`🔌 [LLM节点] 使用现有连接: ${server.name}`);
                    const tools = await existingClient.listTools();
                    allTools.push(...tools);
                    console.log(`🔌 [LLM节点] 成功加载 ${tools.length} 个MCP工具:`, tools.map(t => t.name).join(', '));
                    addNodeCodeLog(`🔌 [LLM节点] 成功加载 ${tools.length} 个MCP工具: ${tools.map(t => t.name).join(', ')}`);
                  } else {
                    // 需要连接
                    console.log(`🔌 [LLM节点] 正在连接MCP服务器: ${server.name}`);
                    addNodeCodeLog(`🔌 [LLM节点] 正在连接MCP服务器: ${server.name}`);
                    const mcpServer = {
                      id: server.id,
                      name: server.name,
                      url: server.url,
                      type: server.type as 'http-stream' | 'http-post' | 'stdio',
                      enabled: server.enabled,
                      description: server.description,
                      metadata: server.metadata,
                      ext: server.ext, // 传递扩展配置（包括 response_format, server_type 等）
                    };
                    await mcpManager.addServer(mcpServer);
                  
                    const client = mcpManager.getClient(server.id);
                    if (client) {
                      const tools = await client.listTools();
                      allTools.push(...tools);
                      console.log(`🔌 [LLM节点] 成功加载 ${tools.length} 个MCP工具:`, tools.map(t => t.name).join(', '));
                      addNodeCodeLog(`🔌 [LLM节点] 成功加载 ${tools.length} 个MCP工具: ${tools.map(t => t.name).join(', ')}`);
                    }
                  }
                } catch (error) {
                  console.warn(`⚠️ [LLM节点] 无法连接MCP服务器 ${server.name} (${server.id}):`, error);
                  addNodeCodeLog(`⚠️ [LLM节点] 无法连接MCP服务器 ${server.name}: ${error instanceof Error ? error.message : String(error)}`);
                }
              } else {
                console.warn(`⚠️ [LLM节点] 配置的MCP服务器ID (${node.data.mcpServerId}) 不存在或未启用`);
                addNodeCodeLog(`⚠️ [LLM节点] 配置的MCP服务器ID (${node.data.mcpServerId}) 不存在或未启用`);
              }
            } else {
              console.log('ℹ️ [LLM节点] 未配置MCP服务器，将不使用任何MCP工具');
              addNodeCodeLog('ℹ️ [LLM节点] 未配置MCP服务器，将不使用任何MCP工具');
            }
          
            // 创建LLM客户端
            const llmClient = new LLMClient({
              id: llmConfig.config_id,
              provider: llmConfig.provider,
              name: llmConfig.name,
              apiKey: apiKey,
              apiUrl: llmConfig.api_url,
              model: llmConfig.model,
              enabled: llmConfig.enabled,
              metadata: llmConfig.metadata,
            });
          
            // 构建系统提示词
            let systemPrompt = '你是一个智能工作流助手，可以帮助用户完成各种任务。';
          
            if (allTools.length > 0 && node.data.mcpServerId) {
              const mcpServerName = mcpServers.find(s => s.id === node.data.mcpServerId)?.name || '未知MCP服务器';
              systemPrompt += `\n\n【重要】本次请求配置的MCP服务器是：${mcpServerName} (ID: ${node.data.mcpServerId})\n\n你只能使用以下来自 ${mcpServerName} 的 MCP 工具来帮助用户完成任务，不要使用其他MCP服务器的工具：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
              console.log(`💬 [LLM节点] 系统提示词已明确指定MCP服务器: ${mcpServerName}`);
              addNodeCodeLog(`💬 [LLM节点] 系统提示词已明确指定MCP服务器: ${mcpServerName}`);
            } else if (allTools.length > 0) {
              systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
            } else {
              systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
            }
          
            // 设置工具流式输出回调，实时打印到日志
            llmClient.setOnToolStream((toolName, chunk) => {
              let displayText = '';
            
              if (chunk.type === 'parsed') {
                // 已解析的JSON数据
                displayText = JSON.stringify(chunk.content, null, 2).substring(0, 500);
              } else if (chunk.type === 'text') {
                // 纯文本内容
                displayText = chunk.content.substring(0, 500);
              } else if (chunk.content) {
                // 其他类型的内容
                displayText = typeof chunk.content === 'string'
                  ? chunk.content.substring(0, 500)
                  : JSON.stringify(chunk.content, null, 2).substring(0, 500);
              } else if (chunk.raw) {
                // 原始数据
                displayText = chunk.content.substring(0, 500);
              }
            
              if (displayText) {
                addNodeCodeLog(`📡 [MCP工具流式输出] ${toolName}:\n${displayText}${displayText.length >= 500 ? '\n...' : ''}`);
              }
            });
          
            // 执行LLM请求（只有在配置了MCP服务器时才传递工具列表）
            const response = await llmClient.handleUserRequest(currentInput, systemPrompt, allTools.length > 0 ? allTools : undefined);
          
            nodeOutput = response;
            nodeOutputs.set(nodeId, nodeOutput);
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          } else if (node.type === 'workflow') {
            const workflowId = node.data.workflowId;
            if (!workflowId) {
              throw new Error(`节点 ${nodeId} 未配置工作流`);
            }
          
            const workflow = workflows.find(w => (w.id || w.workflow_id) === workflowId);
            if (!workflow) {
              throw new Error(`找不到工作流: ${workflowId}`);
            }
          
            // 执行子工作流（黑盒执行）
            const workflowStartTime = Date.now();
            try {
              const result = await executeWorkflow(workflowId, currentInput);
              const workflowDuration = Date.now() - workflowStartTime;
            
              // 从结果中提取输出（根据后端返回的格式）
              const output = result.output || result.result || JSON.stringify(result);
              nodeOutput = typeof output === 'string' ? output : JSON.stringify(output);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              throw new Error(`子工作流执行失败: ${errorMessage}`);
            }
          
            nodeOutputs.set(nodeId, nodeOutput);
            setNodeOutputCache(prev => ({
              ...prev,
              [nodeId]: nodeOutput
            }));
          }
        
          // 检查是否有输出节点连接到当前节点
          const connectedOutputNodes = connections
            .filter(conn => conn.source === nodeId)
            .map(conn => nodes.find(n => n.id === conn.target && n.type === 'output'))
            .filter((node): node is NonNullable<typeof node> => node !== undefined);
        
          if (connectedOutputNodes.length > 0 && nodeOutput) {
            connectedOutputNodes.forEach(outputNode => {
              setOutputNodeResult(prev => ({
                ...prev,
                [outputNode.id]: nodeOutput
              }));
            });
          }
        
          const duration = Date.now() - stepStartTime;
        
          setExecutionLogs(prev => {
            const newLogs = [...prev];
            const lastLog = newLogs[newLogs.length - 1];
            if (lastLog && lastLog.nodeId === nodeId) {
              newLogs[newLogs.length - 1] = {
                ...lastLog,
                status: 'success',
                duration,
                message: `${node.type}节点执行完成`,
                timestamp: Date.now(),
              };
            }
            return newLogs;
          });
        
          setTimeout(() => {
            setCurrentExecutingNodeId(null);
          }, 0);
        }
      
        console.log('\n' + '='.repeat(80));
        console.log('🎉 [节点执行] 执行成功！');
        console.log('='.repeat(80));
        addCodeLog('='.repeat(60));
        addCodeLog('🎉 [节点执行] 执行成功！');
        addCodeLog('='.repeat(60));
      
        setExecutionLogs(prev => [...prev, {
          step: stepCount + 1,
          nodeType: 'complete',
          nodeId: 'complete',
          message: '节点执行成功',
          status: 'success',
          timestamp: Date.now(),
          isCodeLog: false,
        }]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('\n' + '='.repeat(80));
        console.error('❌ [节点执行] 执行失败:', errorMessage);
        console.error('='.repeat(80));
      
        setExecutionLogs(prev => [...prev, {
          step: prev.length,
          nodeType: 'error',
          nodeId: 'error',
          message: `执行失败: ${errorMessage}`,
          status: 'error',
          timestamp: Date.now(),
          isCodeLog: false,
        }]);
      
        addCodeLog('='.repeat(60));
        addCodeLog('❌ [节点执行] 执行失败');
        addCodeLog('='.repeat(60));
      } finally {
        setIsExecuting(false);
        setCurrentExecutingNodeId(null);
        setExecutingNodeIds(new Set()); // 清除所有执行节点ID
        console.log('🏁 [节点执行] 执行流程结束\n');
        addCodeLog('🏁 [节点执行] 执行流程结束');
      }
    };
  
    // 渲染节点
    const renderNode = (node: WorkflowNode) => {
      const baseStyle = {
        left: `${node.position.x}px`,
        top: `${node.position.y}px`,
      };
    
      let content: React.ReactNode;
      let bgColor = '';
    
      switch (node.type) {
        case 'llm':
          bgColor = 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700';
          const llmConfig = llmConfigs.find(c => c.config_id === node.data.llmConfigId);
          const mcpServer = node.data.mcpServerId ? mcpServers.find(s => s.id === node.data.mcpServerId) : null;
          content = (
            <div className="p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-1">
                  <Brain className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-medium">LLM</span>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    className="node-config-btn p-0.5 hover:bg-green-200 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExecuteFromNode(node.id);
                    }}
                    title="从该节点开始执行"
                    disabled={isExecuting}
                  >
                    <Play className="w-3 h-3 text-green-600" />
                  </button>
                  <button
                    className="node-config-btn p-0.5 hover:bg-blue-200 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConfigureNode(node);
                    }}
                    title="配置"
                  >
                    <Settings className="w-3 h-3 text-blue-600" />
                  </button>
                </div>
              </div>
              {llmConfig ? (
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{llmConfig.name}</div>
              ) : (
                <div className="text-xs text-gray-400">未配置</div>
              )}
              {mcpServer && (
                <div className="text-xs text-green-600 mt-0.5 truncate flex items-center" title={mcpServer.name}>
                  <Plug className="w-3 h-3 mr-0.5 flex-shrink-0" />
                  <span className="truncate">{mcpServer.name}</span>
                </div>
              )}
              {nodeDurations[node.id] !== undefined && (
                <div className="text-xs text-gray-600 dark:text-gray-400 font-medium mt-0.5">
                  ⏱️ {nodeDurations[node.id]}ms
                </div>
              )}
            </div>
          );
          break;
        case 'input':
          bgColor = 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700';
          const inputValue = inputNodeValue[node.id] || '';
          // 检查是否有输入连接
          const hasInputConnection = connections.some(conn => conn.target === node.id);
          content = (
            <div className="p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-1">
                  <FileText className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-medium">输入</span>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    className="node-config-btn p-0.5 hover:bg-green-200 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExecuteFromNode(node.id);
                    }}
                    title="从该节点开始执行"
                    disabled={isExecuting}
                  >
                    <Play className="w-3 h-3 text-green-600" />
                  </button>
                  <button
                    className="node-config-btn p-0.5 hover:bg-purple-200 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInputNodeDoubleClick(node);
                    }}
                    title="编辑附加输入"
                  >
                    <Settings className="w-3 h-3 text-purple-600" />
                  </button>
                </div>
              </div>
              {hasInputConnection && (
                <div className="text-xs text-green-600 font-medium mb-0.5 flex items-center space-x-1">
                  <span>⬅</span>
                  <span>接收上游</span>
                </div>
              )}
              {inputValue ? (
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-full" title={inputValue}>
                  <span className="text-gray-400">+</span> {inputValue.length > 12 ? inputValue.substring(0, 12) + '...' : inputValue}
                </div>
              ) : (
                <div className="text-xs text-gray-400 italic">
                  {hasInputConnection ? '双击附加提示词' : '双击输入'}
                </div>
              )}
              {nodeDurations[node.id] !== undefined && (
                <div className="text-xs text-gray-600 dark:text-gray-400 font-medium mt-0.5">
                  ⏱️ {nodeDurations[node.id]}ms
                </div>
              )}
            </div>
          );
          break;
        case 'output':
          bgColor = 'bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700';
          const outputValue = outputNodeResult[node.id] || '';
          // 查找连接到这个输出节点的上游节点
          const outputSourceConnection = connections.find(conn => conn.target === node.id);
          const outputSourceNode = outputSourceConnection
            ? nodes.find(n => n.id === outputSourceConnection.source)
            : null;
          content = (
            <div className="p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-1">
                  <FileText className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-medium">输出</span>
                </div>
                <button
                  className="node-config-btn p-0.5 hover:bg-green-200 rounded"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExecuteFromNode(node.id);
                  }}
                  title="从该节点开始执行"
                  disabled={isExecuting}
                >
                  <Play className="w-3 h-3 text-green-600" />
                </button>
              </div>
              {outputSourceNode && (
                <div className="text-xs text-blue-600 font-medium mt-0.5 flex items-center space-x-1">
                  <span>⬅</span>
                  <span>观察: {outputSourceNode.type}</span>
                </div>
              )}
              {!outputSourceNode && (
                <div className="text-xs text-gray-400 italic mt-0.5">未连接</div>
              )}
              {nodeDurations[node.id] !== undefined && (
                <div className="text-xs text-gray-600 dark:text-gray-400 font-medium mt-0.5">
                  ⏱️ {nodeDurations[node.id]}ms
                </div>
              )}
            </div>
          );
          break;
        case 'workflow':
          bgColor = 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700';
          const selectedWorkflow = node.data.workflowId
            ? workflows.find(w => (w.id || w.workflow_id) === node.data.workflowId)
            : null;
          content = (
            <div className="p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-1">
                  <GitBranch className="w-4 h-4 text-red-600" />
                  <span className="text-xs font-medium">工作流</span>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    className="node-config-btn p-0.5 hover:bg-green-200 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExecuteFromNode(node.id);
                    }}
                    title="从该节点开始执行"
                    disabled={isExecuting}
                  >
                    <Play className="w-3 h-3 text-green-600" />
                  </button>
                  <button
                    className="node-config-btn p-0.5 hover:bg-red-200 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConfigureNode(node);
                    }}
                    title="配置工作流"
                  >
                    <Settings className="w-3 h-3 text-red-600" />
                  </button>
                </div>
              </div>
              {selectedWorkflow ? (
                <div className="space-y-1">
                  <div className="text-xs text-red-700 font-semibold truncate" title={selectedWorkflow.name}>
                    {selectedWorkflow.name}
                  </div>
                  <div className="text-xs text-gray-500 italic">
                    黑盒执行
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-400 italic">未选择工作流</div>
              )}
            </div>
          );
          break;
        case 'terminal':
          const terminalType = node.data.terminalType || 'cursor-agent';
          // 获取terminal类型的显示名称
          const getTerminalTypeName = (type: string) => {
            const typeMap: Record<string, string> = {
              'cursor-agent': 'cursor-agent',
              'bash': 'bash',
              'zsh': 'zsh',
              'powershell': 'PowerShell',
              'cmd': 'CMD',
              'python': 'Python',
              'node': 'Node.js',
            };
            return typeMap[type] || type;
          };
          content = (
            <div className="p-2 flex flex-col items-center justify-center min-h-[56px] bg-gray-900 text-white rounded">
              <div className="flex items-center space-x-1 mb-1">
                <Terminal className="w-4 h-4 text-white" />
                <span className="text-xs font-semibold text-white">命令行</span>
              </div>
              <div className="text-[10px] text-gray-300 truncate w-full text-center">
                {getTerminalTypeName(terminalType)}
              </div>
            </div>
          );
          bgColor = 'bg-gray-900 border-gray-700';
          break;
        case 'visualization':
          const vizType = node.data.visualizationType || 'json-object'; // Default to json-object
          const vizTypeNames = {
            'json-object': 'JSON对象',
            'json-array': 'JSON数组',
            'weblink': '网页链接'
          };
          content = (
            <div className="p-2 flex flex-col items-center justify-center min-h-[56px] bg-orange-50 dark:bg-orange-900/30 rounded">
               <div className="flex items-center space-x-1 mb-1">
                  <Layout className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">数据格式展示</span>
               </div>
               <div className="text-[10px] text-orange-500 dark:text-orange-400 truncate w-full text-center">
                 {vizTypeNames[vizType] || vizType}
               </div>
               {node.data.label && (
                  <div className="text-[9px] text-gray-400 truncate w-full text-center mt-0.5">
                    {node.data.label}
                  </div>
               )}
            </div>
          );
          bgColor = 'bg-white dark:bg-orange-900/30 border-orange-300 dark:border-orange-700';
          break;
      }
    
      const isNodeExecuting = executingNodeIds.has(node.id) || currentExecutingNodeId === node.id;
    
      // 根据节点类型确定端口颜色
      const getPortColor = (type: string, isInput: boolean) => {
        if (type === 'input') {
          // input节点：输入端口和输出端口都是紫色
          return 'bg-purple-500 hover:bg-purple-600';
        } else if (type === 'llm') {
          // llm节点：输入端口是灰色，输出端口是蓝色
          return isInput ? 'bg-gray-400 hover:bg-gray-500' : 'bg-blue-500 hover:bg-blue-600';
        } else if (type === 'workflow') {
          // workflow节点：输入端口是灰色，输出端口是红色
          return isInput ? 'bg-gray-400 hover:bg-gray-500' : 'bg-red-500 hover:bg-red-600';
        } else if (type === 'terminal') {
          // terminal节点：输入端口是灰色，输出端口是绿色
          return isInput ? 'bg-gray-400 hover:bg-gray-500' : 'bg-green-500 hover:bg-green-600';
        } else if (type === 'output') {
          // output节点：只有输入端口，是橙色
          return 'bg-orange-500 hover:bg-orange-600';
        } else if (type === 'visualization') {
           // visualization节点: 输入灰色，输出黄色
           return isInput ? 'bg-gray-400 hover:bg-gray-500' : 'bg-yellow-500 hover:bg-yellow-600';
        }
        return 'bg-gray-400 hover:bg-gray-500';
      };
    
      // 获取节点尺寸（用于动态计算光谱边框）
      // 默认尺寸：节点112px + 左右各6px = 124px，节点高度56px + 上下各6px = 68px
      // 但实际节点高度可能因内容而变化，所以使用动态计算
      const nodeSize = nodeSizes[node.id] || {
        width: 124,  // 112px (w-28) + 12px (左右各6px)
        height: 68   // 56px (基础高度) + 12px (上下各6px)
      };
    
      return (
        <>
          {/* 动态光谱边框特效 - 当节点正在执行时显示 */}
          {isNodeExecuting && (
            <div
              className="absolute pointer-events-none spectrum-border"
              style={{
                left: `${node.position.x - 6}px`,
                top: `${node.position.y - 6}px`,
                width: `${nodeSize.width}px`,
                height: `${nodeSize.height}px`,
                zIndex: 9,
              }}
            >
              <div className="spectrum-border-inner"></div>
            </div>
          )}
          <div
            key={node.id}
            ref={(el) => {
              nodeRefs.current[node.id] = el;
            }}
            className={`absolute w-28 border-2 rounded-lg cursor-move ${bgColor} ${isNodeExecuting ? 'ring-2 ring-blue-400 ring-opacity-30' : ''}`}
            style={{
              ...baseStyle,
              zIndex: isNodeExecuting ? 10 : 1,
              transition: 'all 0.3s ease',
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (node.type === 'input') {
                handleInputNodeDoubleClick(node);
              } else if (node.type === 'llm') {
                handleConfigureNode(node);
              }
            }}
          >
            {content}
            {/* 输入端口（所有节点都有输入端口，用于接收上游连接） */}
            <div
              className={`absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white rounded-full cursor-pointer z-10 ${getPortColor(node.type, true)}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleInputPortClick(e, node.id);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title={node.type === 'input' ? '接收输入' : '连接输入'}
            />
            {/* 输出端口（input, llm, output, visualization, workflow, terminal节点都有输出端口） */}
            <div
              className={`absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white rounded-full cursor-pointer z-10 ${getPortColor(node.type, false)}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleOutputPortClick(e, node.id);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="连接输出"
            />
            
            <button
              className="node-delete-btn absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 z-20"
              onClick={(e) => {
                e.stopPropagation();
                setNodes(prev => prev.filter(n => n.id !== node.id));
                setConnections(prev => prev.filter(c => c.source !== node.id && c.target !== node.id));
              }}
              title="删除节点"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        
          {/* 输入节点下方显示输入内容（上下文信息） */}
          {node.type === 'input' && (inputNodeValue[node.id] || connections.some(conn => conn.target === node.id)) && (
            <div
              className="absolute bg-purple-50 border-2 border-purple-200 rounded-lg p-3 shadow-md z-20"
              style={{
                left: `${node.position.x}px`,
                top: `${node.position.y + 50}px`,
                width: '250px',
                maxHeight: '150px',
                overflow: 'auto',
              }}
            >
              <div className="flex items-center space-x-1 mb-2 pb-1 border-b border-purple-200">
                <FileText className="w-3 h-3 text-purple-600" />
                <span className="text-xs font-semibold text-purple-700">上下文组成</span>
              </div>
              {connections.some(conn => conn.target === node.id) && (
                <div className="text-xs text-green-700 mb-2 bg-green-50 p-2 rounded border border-green-200">
                  <span className="font-semibold">⬅ 上游输出</span>
                  <div className="text-gray-500 mt-0.5">来自前序节点</div>
                </div>
              )}
              {inputNodeValue[node.id] && (
                <div className="text-xs text-gray-700 dark:text-gray-300 break-words whitespace-pre-wrap leading-relaxed">
                  <span className="font-semibold text-purple-600 dark:text-purple-400">+ 附加内容：</span>
                  <div className="mt-1">{inputNodeValue[node.id]}</div>
                </div>
              )}
            </div>
          )}
        
          {/* 输出节点下方显示输出内容 */}
          {node.type === 'output' && (() => {
            const outputSourceConnection = connections.find(conn => conn.target === node.id);
            const outputSourceNode = outputSourceConnection
              ? nodes.find(n => n.id === outputSourceConnection.source)
              : null;
            const isExpanded = expandedOutputNodeId === node.id;
            return (
              <>
                <div
                  className="absolute bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] rounded-lg p-2 shadow-md z-20"
                  style={{
                    left: `${node.position.x}px`,
                    top: `${node.position.y + 50}px`,
                    width: isExpanded ? '600px' : '300px',
                    maxHeight: isExpanded ? '500px' : '200px',
                    overflow: 'auto',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    {outputSourceNode && (
                      <div className="text-xs text-blue-700">
                        <span className="font-semibold">⬅ 观察节点: {outputSourceNode.type}</span>
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedOutputNodeId(isExpanded ? null : node.id);
                      }}
                      className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title={isExpanded ? '缩小' : '放大'}
                    >
                      {isExpanded ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {outputNodeResult[node.id] ? (
                    <div className="text-xs text-gray-700 dark:text-gray-300 break-words whitespace-pre-wrap">
                      {outputNodeResult[node.id]}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 italic">等待执行结果...</div>
                  )}
                </div>
              </>
            );
          })()}

          {/* 展示组件渲染 */}
          {node.type === 'visualization' && (() => {
            const vizInput = outputNodeResult[node.id] || nodeInputCache[node.id];
            const size = visualizationNodeSizes[node.id] || { width: 400, height: 500 };
            return (
              <div
                className="absolute z-20"
                style={{
                  left: `${node.position.x}px`,
                  top: `${node.position.y + 50}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-lg border border-gray-200 dark:border-[#505050] overflow-hidden flex flex-col w-full h-full relative">
                  {/* Content Area */}
                  <div className="flex-1 overflow-auto text-xs">
                    {vizInput ? (
                      <DataVisualizer data={vizInput} type={node.data.visualizationType} />
                    ) : (
                      <div className="p-4 text-center text-gray-400 bg-gray-50 text-xs h-full flex items-center justify-center">
                        等待数据输入...
                      </div>
                    )}
                  </div>

                  {/* Resize Handle */}
                  <div 
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center z-30 bg-white/80 dark:bg-[#2d2d2d]/80 rounded-tl"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setResizingVisualization({
                        nodeId: node.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        startWidth: size.width,
                        startHeight: size.height
                      });
                    }}
                    title="拖动调整大小"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                      <path d="M21 15l-6 6" />
                      <path d="M21 9l-12 12" />
                    </svg>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      );
    };
  
    // 计算连接线路径（贝塞尔曲线）
    const getConnectionPath = (source: WorkflowNode, target: WorkflowNode) => {
      // 获取节点的实际高度（用于计算端口位置）
      const sourceHeight = nodeSizes[source.id]?.height || 68; // 默认高度68px
      const targetHeight = nodeSizes[target.id]?.height || 68;
    
      // 从源节点右侧端口到目标节点左侧端口
      // 端口位置在节点垂直中心（top-1/2 -translate-y-1/2）
      const x1 = source.position.x + 112; // 源节点右侧（w-28 = 112px）
      const y1 = source.position.y + sourceHeight / 2;  // 节点垂直中心
      const x2 = target.position.x;       // 目标节点左侧
      const y2 = target.position.y + targetHeight / 2; // 节点垂直中心
    
      const dx = x2 - x1;
      const cp1x = x1 + Math.abs(dx) * 0.5;
      const cp1y = y1;
      const cp2x = x2 - Math.abs(dx) * 0.5;
      const cp2y = y2;
    
      return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    };
  
    // 计算连接线的中点位置（用于放置删除按钮）
    const getConnectionMidpoint = (source: WorkflowNode, target: WorkflowNode) => {
      // 获取节点的实际高度
      const sourceHeight = nodeSizes[source.id]?.height || 68;
      const targetHeight = nodeSizes[target.id]?.height || 68;
    
      const x1 = source.position.x + 112;
      const y1 = source.position.y + sourceHeight / 2;
      const x2 = target.position.x;
      const y2 = target.position.y + targetHeight / 2;
    
      // 对于贝塞尔曲线，中点大约在控制点之间
      const dx = x2 - x1;
      const midX = x1 + dx * 0.5;
      const midY = (y1 + y2) / 2;
    
      return { x: midX, y: midY };
    };
  
    return (
      <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#1a1a1a] overflow-hidden">
        {/* 顶部工具栏 - 紧凑设计 */}
        <div className="bg-white dark:bg-[#2d2d2d] border-b border-gray-200 dark:border-[#404040] px-3 py-2 flex items-center justify-between flex-shrink-0 overflow-hidden">
          <div className="flex items-center space-x-3">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">工作流编排</h1>
          
            {/* LLM模型选择 */}
            <select
              value={selectedLLMConfigId || ''}
              onChange={(e) => setSelectedLLMConfigId(e.target.value)}
              className="border border-gray-300 dark:border-[#505050] rounded px-2 py-1 text-xs bg-white dark:bg-[#363636] text-gray-900 dark:text-gray-100"
            >
              <option value="">选择LLM</option>
              {llmConfigs.map(config => (
                <option key={config.config_id} value={config.config_id}>
                  {config.name}
                </option>
              ))}
            </select>
          
            {/* 工作流选择 */}
            <select
              value={selectedWorkflowId || ''}
              onChange={(e) => {
                if (e.target.value) {
                  handleLoadWorkflow(e.target.value);
                } else {
                  handleNewWorkflow();
                }
              }}
              className="border border-gray-300 dark:border-[#505050] rounded px-2 py-1 text-xs bg-white dark:bg-[#363636] text-gray-900 dark:text-gray-100"
            >
              <option value="">新建工作流</option>
              {workflows.map(workflow => {
                const workflowId = workflow.id || workflow.workflow_id;
                return (
                  <option key={workflowId} value={workflowId}>
                    {workflow.name}
                  </option>
                );
              })}
            </select>
          
            {/* 工作流名称输入 */}
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="工作流名称"
              className="border border-gray-300 dark:border-[#505050] rounded px-2 py-1 text-xs w-32 bg-white dark:bg-[#363636] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>
        
          <div className="flex items-center space-x-2">
            <button
              onClick={handleExecuteWorkflow}
              disabled={isExecuting}
              className="btn-primary flex items-center space-x-1 px-2 py-1 text-xs disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  <span>执行中...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  <span>执行</span>
                </>
              )}
            </button>
            <button
              onClick={handleSaveWorkflow}
              className="btn-primary flex items-center space-x-1 px-2 py-1 text-xs"
            >
              <Save className="w-3 h-3" />
              <span>保存</span>
            </button>
            <button
              onClick={handleNewWorkflow}
              className="btn-secondary flex items-center space-x-1 px-2 py-1 text-xs"
            >
              <Plus className="w-3 h-3" />
              <span>新建</span>
            </button>
          </div>
        </div>
      
        <div className="flex-1 flex overflow-hidden min-h-0 bg-gray-50 dark:bg-[#1a1a1a]">
          {/* 左侧：组件面板和MCP服务器列表 - 优化布局 */}
          <div className="w-64 bg-white dark:bg-[#2d2d2d] border-r border-gray-200 dark:border-[#404040] flex flex-col flex-shrink-0 h-full shadow-sm">
            {/* 组件面板 - 优化样式 */}
            <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex-shrink-0 bg-gray-50 dark:bg-[#363636]">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center space-x-2">
                <WorkflowIcon className="w-4 h-4" />
                <span>组件库</span>
              </h2>
        <div className="mb-6">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wider px-1">基础组件</div>
          <div className="space-y-2.5">
            <div
              draggable
              onDragStart={(e) => handlePaletteDragStart(e, 'input')}
              className="flex items-center space-x-3 p-3 border border-gray-200 dark:border-[#404040] rounded-xl cursor-move hover:border-primary-500 dark:hover:border-primary-500 hover:shadow-md hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all duration-300 bg-white dark:bg-[#2d2d2d] group card-hover-enhanced"
            >
              <div className="w-8 h-8 rounded-md bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:bg-purple-200 dark:group-hover:bg-purple-800/50 transition-all duration-300 group-hover:scale-110">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">输入节点</div>
                <div className="text-xs text-gray-500">起始输入内容</div>
              </div>
            </div>

            <div
              draggable
              onDragStart={(e) => handlePaletteDragStart(e, 'llm')}
              className="flex items-center space-x-2 p-2 border border-gray-200 dark:border-[#404040] rounded-lg cursor-move hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all duration-300 bg-white dark:bg-[#2d2d2d] group card-hover-enhanced"
            >
              <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition-all duration-300 group-hover:scale-110">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">LLM节点</div>
                <div className="text-xs text-gray-500">大语言模型处理</div>
              </div>
            </div>

            <div
              draggable
              onDragStart={(e) => handlePaletteDragStart(e, 'workflow')}
              className="flex items-center space-x-2 p-2 border border-gray-200 dark:border-[#404040] rounded-lg cursor-move hover:border-red-500 dark:hover:border-red-400 hover:shadow-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-all duration-300 bg-white dark:bg-[#2d2d2d] group card-hover-enhanced"
            >
              <div className="w-8 h-8 rounded-md bg-red-100 dark:bg-red-900/50 flex items-center justify-center text-red-600 dark:text-red-400 group-hover:bg-red-200 dark:group-hover:bg-red-800/50 transition-all duration-300 group-hover:scale-110">
                <GitBranch className="w-4 h-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">子工作流</div>
                <div className="text-xs text-gray-500">嵌套其他工作流</div>
              </div>
            </div>

            <div
              draggable
              onDragStart={(e) => handlePaletteDragStart(e, 'output')}
              className="flex items-center space-x-2 p-2 border border-gray-200 dark:border-[#404040] rounded-lg cursor-move hover:border-green-500 dark:hover:border-green-400 hover:shadow-md hover:bg-green-50 dark:hover:bg-green-900/30 transition-all duration-300 bg-white dark:bg-[#2d2d2d] group card-hover-enhanced"
            >
              <div className="w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/50 flex items-center justify-center text-green-600 dark:text-green-400 group-hover:bg-green-200 dark:group-hover:bg-green-800/50 transition-all duration-300 group-hover:scale-110">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">输出节点</div>
                <div className="text-xs text-gray-500">显示/传递结果</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wider px-1">展示与工具</div>
          <div className="space-y-2.5">
            <div
              draggable
              onDragStart={(e) => handlePaletteDragStart(e, 'visualization')}
              className="flex items-center space-x-2 p-2 border border-gray-200 dark:border-[#404040] rounded-lg cursor-move hover:border-orange-500 dark:hover:border-orange-400 hover:shadow-md hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-all duration-300 bg-white dark:bg-[#2d2d2d] group card-hover-enhanced"
            >
              <div className="w-8 h-8 rounded-md bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center text-orange-600 dark:text-orange-400 group-hover:bg-orange-200 dark:group-hover:bg-orange-800/50 transition-all duration-300 group-hover:scale-110">
                <Layout className="w-4 h-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">数据格式展示</div>
                <div className="text-xs text-gray-500">结构化数据可视化</div>
              </div>
            </div>

            <div
              draggable
              onDragStart={(e) => handlePaletteDragStart(e, 'terminal')}
              className="flex items-center space-x-2 p-2 border border-gray-200 dark:border-[#404040] rounded-lg cursor-move hover:border-gray-500 dark:hover:border-gray-400 hover:shadow-md hover:bg-gray-50 dark:hover:bg-[#363636] transition-all duration-300 bg-white dark:bg-[#2d2d2d] group card-hover-enhanced"
            >
              <div className="w-8 h-8 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-all duration-300 group-hover:scale-110">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">命令行</div>
                <div className="text-xs text-gray-500">执行系统命令</div>
              </div>
            </div>
          </div>
        </div>
            </div>
          
            {/* MCP服务器列表 */}
            <div className="flex-1 overflow-y-auto p-2" style={{ minHeight: 0, maxHeight: 'calc(100vh - 380px)' }}>
              <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">MCP服务器</h2>
              <div className="space-y-1">
                {mcpServers.length === 0 ? (
                  <div className="text-xs text-gray-400 italic">暂无服务器</div>
                ) : (
                  mcpServers.map(server => (
                    <div
                      key={server.id}
                      className="p-1.5 border border-gray-300 dark:border-[#505050] rounded text-xs hover:bg-gray-50 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300"
                    >
                      {server.name}
                    </div>
                  ))
                )}
              </div>
            </div>
          
          </div>
        
          {/* 中间：工作流画布和结果展示 */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden transition-all duration-300`}>
            {/* 画布区域 - 无限画布 */}
            <div
              ref={canvasRef}
              className="flex-1 relative bg-gray-50 dark:bg-[#252525] overflow-auto hide-scrollbar"
              style={{
                cursor: isPanning ? 'grabbing' : 'default',
              }}
              onDrop={handleCanvasDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={(e) => {
                // 点击画布空白处取消连接
                // 如果点击的是SVG元素（连接线），不处理
                const target = e.target as HTMLElement;
                if (target.tagName === 'svg' || target.closest('svg')) {
                  return; // 不处理SVG内的点击
                }
                if (connecting.sourceNodeId && (target.classList.contains('canvas-bg') || target === e.currentTarget)) {
                  setConnecting({ sourceNodeId: null, targetNodeId: null, tempEnd: null });
                }
              }}
              onMouseDown={(e) => {
                // 右键或中键拖动画布
                if (e.button === 2 || e.button === 1) {
                  e.preventDefault();
                  setIsPanning(true);
                  setPanStart({
                    x: e.clientX + (canvasRef.current?.scrollLeft || 0),
                    y: e.clientY + (canvasRef.current?.scrollTop || 0),
                  });
                }
              }}
              onMouseMove={(e) => {
                if (isPanning && canvasRef.current) {
                  e.preventDefault();
                  canvasRef.current.scrollLeft = panStart.x - e.clientX;
                  canvasRef.current.scrollTop = panStart.y - e.clientY;
                }
              }}
              onMouseUp={(e) => {
                if (e.button === 2 || e.button === 1) {
                  setIsPanning(false);
                }
              }}
              onMouseLeave={() => {
                setIsPanning(false);
              }}
              onContextMenu={(e) => {
                // 阻止右键菜单
                e.preventDefault();
              }}
            >
              {/* 虚线网格背景 */}
              <div
                className="canvas-bg absolute"
                style={{
                  left: 0,
                  top: 0,
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  backgroundImage: isDarkMode
                    ? `linear-gradient(to right, #404040 1px, transparent 1px),
                       linear-gradient(to bottom, #404040 1px, transparent 1px)`
                    : `linear-gradient(to right, #d1d5db 1px, transparent 1px),
                       linear-gradient(to bottom, #d1d5db 1px, transparent 1px)`,
                  backgroundSize: '20px 20px',
                  pointerEvents: 'none',
                }}
              />
            
              {/* 渲染连接线 */}
              <svg
                className="absolute"
                style={{
                  left: 0,
                  top: 0,
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  zIndex: 1,
                  pointerEvents: 'auto',
                }}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="2.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 2.5, 0 5" fill="#3b82f6" />
                  </marker>
                </defs>
              
                {/* 已建立的连接 - 实线 */}
                {connections.map(conn => {
                  const sourceNode = nodes.find(n => n.id === conn.source);
                  const targetNode = nodes.find(n => n.id === conn.target);
                
                  if (!sourceNode || !targetNode) {
                    console.warn('[连接线] 找不到节点:', {
                      connectionId: conn.id,
                      source: conn.source,
                      target: conn.target,
                      availableNodes: nodes.map(n => n.id)
                    });
                    return null;
                  }
                
                  const path = getConnectionPath(sourceNode, targetNode);
                  const midpoint = getConnectionMidpoint(sourceNode, targetNode);
                
                  console.log('[连接线] 渲染连接:', {
                    connectionId: conn.id,
                    source: conn.source,
                    target: conn.target,
                    path: path,
                    sourcePos: sourceNode.position,
                    targetPos: targetNode.position,
                  });
                
                  return (
                    <g key={conn.id} className="connection-group">
                      {/* 可见的连接线 */}
                      <path
                        d={path}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        fill="none"
                        markerEnd="url(#arrowhead)"
                        opacity="0.7"
                        style={{ pointerEvents: 'none' }}
                      />
                      {/* 连接线 - 增加点击区域（用于双击删除） */}
                      <path
                        d={path}
                        stroke="transparent"
                        strokeWidth="12"
                        fill="none"
                        style={{ cursor: 'pointer' }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          console.log('[连接线] 双击删除连接:', conn.id);
                          handleDeleteConnection(conn.id);
                        }}
                      />
                      {/* 删除按钮 - 在中点位置，最后渲染确保在最上层 */}
                      <g
                        transform={`translate(${midpoint.x}, ${midpoint.y})`}
                        className="connection-delete-btn"
                        style={{ cursor: 'pointer', opacity: '0.6' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          console.log('[连接线] 点击删除按钮:', conn.id);
                          handleDeleteConnection(conn.id);
                        }}
                        onMouseDown={(e) => {
                          // 阻止事件冒泡，确保点击事件被正确处理
                          e.stopPropagation();
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.6';
                        }}
                      >
                        {/* 更大的点击区域（透明） */}
                        <circle
                          cx="0"
                          cy="0"
                          r="16"
                          fill="transparent"
                          stroke="none"
                          style={{ pointerEvents: 'auto' }}
                        />
                        {/* 可见的删除按钮 */}
                        <circle
                          cx="0"
                          cy="0"
                          r="12"
                          fill="white"
                          stroke="#ef4444"
                          strokeWidth="2"
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* X图标 - 使用SVG路径 */}
                        <path
                          d="M -6 -6 L 6 6 M 6 -6 L -6 6"
                          stroke="#ef4444"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          style={{ pointerEvents: 'none' }}
                        />
                      </g>
                    </g>
                  );
                })}
              
                {/* 临时连接线 - 虚线 */}
                {connecting.sourceNodeId && connecting.tempEnd && (() => {
                  const sourceNode = nodes.find(n => n.id === connecting.sourceNodeId);
                  if (!sourceNode || !connecting.tempEnd) return null;
                
                  const x1 = sourceNode.position.x + 112; // 源节点右侧
                  const y1 = sourceNode.position.y + 20;
                  const x2 = connecting.tempEnd.x;
                  const y2 = connecting.tempEnd.y;
                
                  const dx = x2 - x1;
                  const cp1x = x1 + Math.abs(dx) * 0.5;
                  const cp1y = y1;
                  const cp2x = x2 - Math.abs(dx) * 0.5;
                  const cp2y = y2;
                
                  return (
                    <path
                      d={`M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`}
                      stroke="#3b82f6"
                      strokeWidth="2"
                      fill="none"
                      strokeDasharray="5,5"
                      opacity="0.6"
                    />
                  );
                })()}
              </svg>
            
              {/* 渲染节点 */}
              <div
                className="absolute"
                style={{
                  left: 0,
                  top: 0,
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              >
                {nodes.map(node => (
                  <div key={node.id} style={{ pointerEvents: 'auto' }}>
                    {renderNode(node)}
                  </div>
                ))}
              </div>
            </div>
          
            {/* 执行日志面板 - 可拖拽，左下角 */}
            {executionLogs.length > 0 && (
              <div
                className="absolute bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#505050] shadow-xl rounded-lg z-30 w-[600px] h-[400px] overflow-hidden flex flex-col"
                style={{
                  left: `${logPanelPosition.x}px`,
                  top: `${logPanelPosition.y}px`,
                  cursor: isDraggingLogPanel ? 'grabbing' : 'default',
                }}
                onMouseDown={handleLogPanelMouseDown}
              >
                {/* 标题栏 - 可拖拽 */}
                <div className="log-panel-header flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#363636] cursor-move">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${isExecuting ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`}></div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {isExecuting ? '执行中...' : '执行完成'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setExecutionLogs([]);
                      setSelectedLogNodeId(null);
                      setExpandedNodes(new Set());
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              
                {/* 内容区域 - 左右分栏 */}
                <div className="flex-1 flex overflow-hidden">
                  {/* 左侧：节点列表 */}
                  <div className="w-48 border-r border-gray-200 flex flex-col overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-[#363636] border-b border-gray-200 dark:border-[#404040]">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">节点列表</div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {(() => {
                        // 获取所有节点日志（去重，保留最新的日志状态）
                        const nodeLogs = executionLogs.filter(log => !log.isCodeLog && log.nodeId !== 'start' && log.nodeId !== 'complete' && log.nodeId !== 'error');
                        // 使用Map，但保留每个节点的最新日志（按timestamp排序）
                        const nodeLogsByNodeId = new Map<string, typeof nodeLogs[0]>();
                        nodeLogs.forEach(log => {
                          const existing = nodeLogsByNodeId.get(log.nodeId);
                          if (!existing || log.timestamp > existing.timestamp) {
                            nodeLogsByNodeId.set(log.nodeId, log);
                          }
                        });
                        const uniqueNodes = Array.from(nodeLogsByNodeId.values());
                      
                        return (
                          <div className="p-2 space-y-1">
                            {uniqueNodes.map((log) => {
                              const node = nodes.find(n => n.id === log.nodeId);
                              const nodeName = node
                                ? (node.type === 'input' ? '输入' : node.type === 'llm' ? 'LLM' : node.type === 'workflow' ? '工作流' : node.type === 'terminal' ? '命令行' : '输出')
                                : log.nodeType;
                            
                              // 检查节点是否正在执行（用于显示转圈状态）
                              // 通过检查日志消息中是否包含"执行中"来判断是否在执行
                              // 获取该节点的所有状态日志
                              const nodeStatusLogs = executionLogs
                                .filter(l => !l.isCodeLog && l.nodeId === log.nodeId)
                                .sort((a, b) => b.timestamp - a.timestamp);
                              const nodeLatestLog = nodeStatusLogs[0];
                              const actualStatus = nodeLatestLog?.status || log.status;
                            
                              // 检查节点是否正在执行：
                              // 1. 检查状态日志中是否有"执行中"文字
                              // 2. 检查代码日志中是否有"执行中"、"正在执行"、"正在调用"等文字
                              // 3. 检查状态是running且currentExecutingNodeId匹配
                              const nodeCodeLogsForCheck = executionLogs.filter(l => l.isCodeLog && l.nodeId === log.nodeId);
                              const hasExecutingMessage = nodeStatusLogs.some(l =>
                                l.message && (l.message.includes('执行中') || l.message.includes('执行中...'))
                              );
                              const hasExecutingCodeLog = nodeCodeLogsForCheck.some(l =>
                                l.message && (l.message.includes('执行中') || l.message.includes('正在执行') ||
                                  l.message.includes('正在调用') || l.message.includes('执行节点'))
                              );
                              const isNodeExecuting = hasExecutingMessage || hasExecutingCodeLog ||
                                (currentExecutingNodeId === log.nodeId && actualStatus === 'running');
                            
                              // 判断是否完成（状态是success或error，或者消息包含"执行完成"）
                              const isCompleted = actualStatus === 'success' || actualStatus === 'error' ||
                                (nodeLatestLog?.message && nodeLatestLog.message.includes('执行完成'));
                            
                              return (
                                <div
                                  key={log.nodeId}
                                  onClick={() => setSelectedLogNodeId(log.nodeId)}
                                  className={`px-3 py-2 rounded cursor-pointer text-xs transition-colors ${selectedLogNodeId === log.nodeId
                                      ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                                      : 'bg-gray-50 dark:bg-[#363636] hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300'
                                    }`}
                                >
                                  <div className="flex items-center space-x-2">
                                    <div className="flex-shrink-0">
                                      {isNodeExecuting ? (
                                        <Loader className="w-3 h-3 text-blue-500 animate-spin" />
                                      ) : isCompleted ? (
                                        <div className="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
                                          <span className="text-white text-[8px]">✓</span>
                                        </div>
                                      ) : (
                                        <div className="w-3 h-3 rounded-full bg-gray-300"></div>
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium truncate">
                                        {log.nodeType === 'input' ? '📥' :
                                          log.nodeType === 'llm' ? '🤖' :
                                            log.nodeType === 'terminal' ? '💻' :
                                              log.nodeType === 'output' ? '📤' : '❌'}
                                        {' '}
                                        {nodeName}
                                      </div>
                                      {log.duration !== undefined && (
                                        <div className="text-gray-500 text-[10px] mt-0.5">
                                          {log.duration}ms
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
            
                  {/* 右侧：按节点分组的日志 */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-[#363636] border-b border-gray-200 dark:border-[#404040]">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">执行日志</div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {(() => {
                        // 获取所有节点日志（去重，保留最新的日志状态）
                        const nodeLogs = executionLogs.filter(log => !log.isCodeLog && log.nodeId !== 'start' && log.nodeId !== 'complete' && log.nodeId !== 'error');
                        const nodeLogsByNodeId = new Map<string, typeof nodeLogs[0]>();
                        nodeLogs.forEach(log => {
                          const existing = nodeLogsByNodeId.get(log.nodeId);
                          if (!existing || log.timestamp > existing.timestamp) {
                            nodeLogsByNodeId.set(log.nodeId, log);
                          }
                        });
                      
                        // 按执行顺序排序：当前执行的节点置顶，然后按时间戳排序
                        const sortedNodes = Array.from(nodeLogsByNodeId.values()).sort((a, b) => {
                          // 当前执行的节点置顶
                          if (currentExecutingNodeId === a.nodeId) return -1;
                          if (currentExecutingNodeId === b.nodeId) return 1;
                          // 其他按时间戳倒序（最新的在前）
                          return b.timestamp - a.timestamp;
                        });
                      
                        // 如果没有节点日志，显示开始节点日志
                        if (sortedNodes.length === 0) {
                          const startLog = executionLogs.find(log => log.nodeId === 'start');
                          if (startLog) {
                            return (
                              <div className="p-3">
                                <div className={`p-3 rounded-lg border ${startLog.status === 'running' ? 'bg-blue-50 border-blue-200' :
                                    startLog.status === 'success' ? 'bg-green-50 border-green-200' :
                                      'bg-gray-50 border-gray-200'
                                  }`}>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                      {startLog.message}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              等待执行...
                            </div>
                          );
                        }
                      
                        return (
                          <div className="p-2 space-y-2">
                            {sortedNodes.map((log) => {
                              const node = nodes.find(n => n.id === log.nodeId);
                              const nodeName = node
                                ? (node.type === 'input' ? '输入' : node.type === 'llm' ? 'LLM' : node.type === 'workflow' ? '工作流' : node.type === 'terminal' ? '命令行' : '输出')
                                : log.nodeType;
                            
                              // 获取该节点的所有状态日志
                              const nodeStatusLogs = executionLogs
                                .filter(l => !l.isCodeLog && l.nodeId === log.nodeId)
                                .sort((a, b) => b.timestamp - a.timestamp);
                              const nodeLatestStatusLog = nodeStatusLogs[0];
                              const actualStatus = nodeLatestStatusLog?.status || log.status;
                            
                              // 检查节点是否正在执行：
                              // 1. 检查状态日志中是否有"执行中"文字
                              // 2. 检查代码日志中是否有"执行中"、"正在执行"、"正在调用"等文字
                              // 3. 检查状态是running且currentExecutingNodeId匹配
                              const nodeCodeLogsForCheck = executionLogs.filter(l => l.isCodeLog && l.nodeId === log.nodeId);
                              const hasExecutingMessage = nodeStatusLogs.some(l =>
                                l.message && (l.message.includes('执行中') || l.message.includes('执行中...'))
                              );
                              const hasExecutingCodeLog = nodeCodeLogsForCheck.some(l =>
                                l.message && (l.message.includes('执行中') || l.message.includes('正在执行') ||
                                  l.message.includes('正在调用') || l.message.includes('执行节点'))
                              );
                              const isNodeExecuting = hasExecutingMessage || hasExecutingCodeLog ||
                                (currentExecutingNodeId === log.nodeId && actualStatus === 'running');
                            
                              // 判断是否完成（状态是success或error，或者消息包含"执行完成"）
                              const isCompleted = actualStatus === 'success' || actualStatus === 'error' ||
                                (nodeLatestStatusLog?.message && nodeLatestStatusLog.message.includes('执行完成'));
                            
                              const isExpanded = expandedNodes.has(log.nodeId);
                            
                              // 获取该节点的所有日志（包括代码日志）
                              const nodeAllLogs = executionLogs.filter(l => l.nodeId === log.nodeId);
                              const nodeStatusLogsForDisplay = nodeAllLogs.filter(l => !l.isCodeLog);
                              const nodeCodeLogs = nodeAllLogs.filter(l => l.isCodeLog);
                            
                              return (
                                <div
                                  key={log.nodeId}
                                  className={`border rounded-lg overflow-hidden transition-all ${isNodeExecuting
                                      ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 shadow-md'
                                      : isCompleted
                                        ? 'border-green-200 dark:border-green-800 bg-white dark:bg-[#2d2d2d]'
                                        : 'border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d]'
                                    }`}
                                >
                                  {/* 节点标题栏 - 可点击展开/折叠 */}
                                  <div
                                    className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#363636] transition-colors flex items-center justify-between"
                                    onClick={() => {
                                      setExpandedNodes(prev => {
                                        const newSet = new Set(prev);
                                        if (newSet.has(log.nodeId)) {
                                          newSet.delete(log.nodeId);
                                        } else {
                                          newSet.add(log.nodeId);
                                        }
                                        return newSet;
                                      });
                                      setSelectedLogNodeId(log.nodeId);
                                    }}
                                  >
                                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                                      <div className="flex-shrink-0">
                                        {isNodeExecuting ? (
                                          <Loader className="w-4 h-4 text-blue-500 animate-spin" />
                                        ) : isCompleted ? (
                                          <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                                            <span className="text-white text-[10px]">✓</span>
                                          </div>
                                        ) : (
                                          <div className="w-4 h-4 rounded-full bg-gray-300"></div>
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-800 truncate">
                                          {log.nodeType === 'input' ? '📥' :
                                            log.nodeType === 'llm' ? '🤖' :
                                              log.nodeType === 'workflow' ? '🔄' :
                                                log.nodeType === 'terminal' ? '💻' :
                                                  log.nodeType === 'output' ? '📤' : '❌'}
                                          {' '}
                                          {nodeName}
                                        </div>
                                        {log.duration !== undefined && (
                                          <div className="text-xs text-gray-500 mt-0.5">
                                            {log.duration}ms
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center space-x-2 flex-shrink-0">
                                      {isNodeExecuting && (
                                        <span className="text-xs text-blue-600 font-medium">执行中...</span>
                                      )}
                                      {isExpanded ? (
                                        <ChevronUp className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      )}
                                    </div>
                                  </div>
                                
                                  {/* 节点日志内容 - 可折叠 */}
                                  {isExpanded && (
                                    <div className="border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#2d2d2d]">
                                      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                                        {/* 执行日志 - 合并显示所有日志，让日志内容本身反映状态 */}
                                        {(nodeCodeLogs.length > 0 || nodeStatusLogsForDisplay.length > 0) && (
                                          <div>
                                            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">执行日志</div>
                                            <div className="space-y-0.5 bg-white dark:bg-[#363636] rounded border border-gray-200 dark:border-[#404040] p-2 max-h-80 overflow-y-auto">
                                              {/* 先显示状态日志 */}
                                              {nodeStatusLogsForDisplay.map((statusLog, index) => (
                                                <div
                                                  key={`status-${index}`}
                                                  className={`text-xs font-mono py-0.5 leading-relaxed whitespace-pre-wrap break-words ${statusLog.status === 'running' ? 'text-blue-600' :
                                                      statusLog.status === 'success' ? 'text-green-600' :
                                                        statusLog.status === 'error' ? 'text-red-600' :
                                                          'text-gray-600'
                                                    }`}
                                                >
                                                  {statusLog.message}
                                                  {statusLog.duration !== undefined && (
                                                    <span className="text-gray-500 ml-2">({statusLog.duration}ms)</span>
                                                  )}
                                                </div>
                                              ))}
                                              {/* 再显示代码日志 */}
                                              {nodeCodeLogs.map((codeLog, index) => (
                                                <div
                                                  key={`code-${index}`}
                                                  className="text-xs text-gray-600 dark:text-gray-400 font-mono py-0.5 leading-relaxed whitespace-pre-wrap break-words"
                                                >
                                                  {codeLog.message}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        
        </div>
      
        {/* 节点配置弹窗 */}
        {configuringNode && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-[#2d2d2d] rounded-lg p-4 w-96 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">配置节点</h3>
                <button
                  onClick={() => setConfiguringNode(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            
              {configuringNode.type === 'llm' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      LLM模型
                    </label>
                    <select
                      value={configuringNode.data.llmConfigId || ''}
                      onChange={(e) => handleSaveNodeConfig(configuringNode.id, { llmConfigId: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="">选择LLM模型</option>
                      {llmConfigs.map(config => (
                        <option key={config.config_id} value={config.config_id}>
                          {config.name}
                        </option>
                      ))}
                    </select>
                  </div>
                
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      MCP服务器（可选）
                    </label>
                    <select
                      value={configuringNode.data.mcpServerId || ''}
                      onChange={(e) => handleSaveNodeConfig(configuringNode.id, { mcpServerId: e.target.value || undefined })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="">无</option>
                      {mcpServers.map(server => (
                        <option key={server.id} value={server.id}>
                          {server.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            
              {configuringNode.type === 'workflow' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      选择子工作流
                    </label>
                    <select
                      value={configuringNode.data.workflowId || ''}
                      onChange={(e) => handleSaveNodeConfig(configuringNode.id, { workflowId: e.target.value || undefined })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="">选择工作流</option>
                      {workflows
                        .filter(w => {
                          const currentWorkflowId = w.id || w.workflow_id;
                          return currentWorkflowId !== selectedWorkflowId;
                        })
                        .map(workflow => (
                          <option key={workflow.id || workflow.workflow_id} value={workflow.id || workflow.workflow_id}>
                            {workflow.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="text-xs text-gray-500 bg-red-50 dark:bg-red-900/30 p-2 rounded border border-red-200 dark:border-red-800">
                    <div className="font-semibold text-red-700 dark:text-red-400 mb-1">💡 工作流节点说明</div>
                    <div className="text-gray-600 dark:text-gray-400">
                      工作流节点将作为黑盒执行：输入字符串 → 输出字符串。子工作流将接收当前节点的输入，执行后返回输出结果。
                    </div>
                  </div>
                </div>
              )}
            
              {configuringNode.type === 'terminal' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Terminal类型
                    </label>
                    <select
                      value={configuringNode.data.terminalType || 'cursor-agent'}
                      onChange={(e) => handleSaveNodeConfig(configuringNode.id, { terminalType: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="cursor-agent">cursor-agent</option>
                      <option value="bash">bash</option>
                      <option value="zsh">zsh</option>
                      <option value="powershell">PowerShell</option>
                      <option value="cmd">CMD</option>
                      <option value="python">Python</option>
                      <option value="node">Node.js</option>
                    </select>
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 dark:bg-[#363636] p-2 rounded border border-gray-200 dark:border-[#404040]">
                    <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">💡 Terminal节点说明</div>
                    <div className="text-gray-600 dark:text-gray-400">
                      <div className="mb-1">• <strong>cursor-agent</strong>: 将输入作为任务发送到cursor-agent处理</div>
                      <div className="mb-1">• <strong>bash/zsh</strong>: 执行bash/zsh命令</div>
                      <div className="mb-1">• <strong>PowerShell/CMD</strong>: 执行Windows命令</div>
                      <div>• <strong>Python/Node.js</strong>: 执行对应语言的命令</div>
                    </div>
                  </div>
                </div>
              )}

              {configuringNode.type === 'visualization' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      展示类型
                    </label>
                    <select
                      value={configuringNode.data.visualizationType || 'json-object'}
                      onChange={(e) => handleSaveNodeConfig(configuringNode.id, { visualizationType: e.target.value as any })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="json-object">JSON对象 (键值对)</option>
                      <option value="json-array">JSON数组 (列表)</option>
                      <option value="weblink">网页链接 (URL)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      自定义标签
                    </label>
                    <input
                      type="text"
                      value={configuringNode.data.label || ''}
                      onChange={(e) => handleSaveNodeConfig(configuringNode.id, { label: e.target.value })}
                      placeholder="例如：用户信息展示"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded border border-gray-200">
                    <div className="font-semibold text-gray-700 mb-1">💡 数据格式展示说明</div>
                    <div className="text-gray-600">
                      <div className="mb-1">• <strong>JSON对象</strong>: 适合展示键值对数据</div>
                      <div className="mb-1">• <strong>JSON数组</strong>: 适合展示列表或表格数据</div>
                      <div>• <strong>网页链接</strong>: 适合展示 URL 对应的页面内容</div>
                    </div>
                  </div>
                </div>
              )}
            
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setConfiguringNode(null)}
                  className="btn-secondary px-3 py-1 text-sm"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}
      
        {/* 输入节点编辑弹窗 */}
        {editingInputNode && (() => {
          const node = nodes.find(n => n.id === editingInputNode);
          if (!node || node.type !== 'input') return null;
        
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-[#2d2d2d] rounded-lg p-5 w-[500px]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {(() => {
                        const hasUpstream = connections.some(c => c.target === editingInputNode);
                        return hasUpstream ? '附加提示词/说明' : '编辑输入内容';
                      })()}
                    </h3>
                  </div>
                  <button
                    onClick={() => setEditingInputNode(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              
                <div className="space-y-3">
                  {(() => {
                    const hasUpstream = connections.some(c => c.target === editingInputNode);
                    return (
                      <div>
                        {hasUpstream && (
                          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center space-x-2 text-green-700 mb-1">
                              <span className="text-sm font-semibold">⬅ 接收上游输出</span>
                            </div>
                            <p className="text-xs text-green-600">
                              此节点将接收上游节点的输出作为基础内容
                            </p>
                          </div>
                        )}
                      
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {hasUpstream ? '附加提示词/指令 (可选)' : '输入内容'}
                        </label>
                        <textarea
                          value={inputNodeValue[editingInputNode] || ''}
                          onChange={(e) => setInputNodeValue(prev => ({
                            ...prev,
                            [editingInputNode]: e.target.value
                          }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          rows={8}
                          placeholder={hasUpstream
                            ? "在上游输出的基础上，附加额外的提示词或指令，例如：&#10;&#10;请将上述内容：&#10;1. 提取关键信息&#10;2. 生成Markdown格式摘要&#10;3. 突出重要数据"
                            : "请输入工作流的初始内容，例如：&#10;&#10;任务：分析YouTube视频内容&#10;要求：提取关键信息并生成摘要&#10;格式：Markdown格式输出"
                          }
                          autoFocus
                        />
                        <p className="mt-2 text-xs text-gray-500">
                          {hasUpstream
                            ? '💡 提示：这里输入的内容会附加在上游输出之后，作为额外的指令或说明传递给下游节点。'
                            : '💡 提示：这里输入的内容将作为工作流的起始输入，传递给后续节点处理。'
                          }
                        </p>
                      </div>
                    );
                  })()}
                </div>
              
                <div className="mt-5 flex justify-end space-x-2">
                  <button
                    onClick={() => setEditingInputNode(null)}
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleSaveInputNode(editingInputNode)}
                    className="btn-primary px-4 py-2 text-sm"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      
      </div>
    );
  };

export default WorkflowEditor;
