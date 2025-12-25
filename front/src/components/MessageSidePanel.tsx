/**
 * 消息侧边面板组件
 * 显示AI的思考过程、MCP调用返回和工作流执行过程
 * 支持多轮过程数据，按时间顺序分组排列
 */

import React, { useState } from 'react';
import { 
  Brain, 
  ChevronDown, 
  ChevronUp, 
  Plug, 
  Workflow as WorkflowIcon,
  Lightbulb,
  CheckCircle,
  AlertCircle,
  Loader,
  ArrowRight,
  Clock,
  Wrench
} from 'lucide-react';
import { ScrollArea } from './ui/ScrollArea';
import type { MCPDetail } from '../services/sessionApi';
import type { WorkflowNode, WorkflowConnection } from '../services/workflowApi';

/** 单个过程步骤 */
export interface ProcessStep {
  /** 步骤类型 */
  type: 'thinking' | 'mcp_call' | 'workflow';
  /** 时间戳 */
  timestamp?: number;
  /** 思考内容（当 type === 'thinking' 时） */
  thinking?: string;
  /** MCP 服务器名称（当 type === 'mcp_call' 时） */
  mcpServer?: string;
  /** 工具名称（当 type === 'mcp_call' 时） */
  toolName?: string;
  /** 调用参数 */
  arguments?: any;
  /** 调用结果 */
  result?: any;
  /** 执行状态 */
  status?: 'pending' | 'running' | 'completed' | 'error';
  /** 执行时长（毫秒） */
  duration?: number;
  /** 工作流信息（当 type === 'workflow' 时） */
  workflowInfo?: {
    id?: string;
    name?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    result?: string;
    config?: {
      nodes: WorkflowNode[];
      connections: WorkflowConnection[];
    };
  };
}

interface MCPCallInfo {
  name: string;
  arguments: any;
  result?: any;
  status?: 'pending' | 'running' | 'completed' | 'error';
  duration?: number;
}

interface WorkflowInfo {
  id?: string;
  name?: string;
  status?: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
  config?: {
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
  };
}

export interface MessageSidePanelProps {
  /** 思考过程内容（兼容旧接口） */
  thinking?: string;
  /** 是否正在思考 */
  isThinking?: boolean;
  /** MCP 调用详情（兼容旧接口） */
  mcpDetail?: MCPDetail;
  /** 工具调用列表（兼容旧接口） */
  toolCalls?: MCPCallInfo[];
  /** 工作流信息（兼容旧接口） */
  workflowInfo?: WorkflowInfo;
  /** 当前执行步骤 */
  currentStep?: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 思维签名（用于 Gemini） */
  thoughtSignature?: string;
  /** 是否有内容（用于控制面板显示） */
  hasContent?: boolean;
  /** 消息高度（用于同步左侧） */
  messageHeight?: number;
  /** 多轮过程步骤列表（新接口） */
  processSteps?: ProcessStep[];
}

/** MCP 引用信息 */
interface MCPCitation {
  index: number;
  toolName: string;
  mcpServer?: string;
}

/** 
 * 渲染带有 MCP 引用标记的思考内容
 * 将文本中的工具调用引用转换为带样式的引用标记
 */
const renderThinkingWithCitations = (content: string, citations: MCPCitation[]): React.ReactNode => {
  if (!content || citations.length === 0) {
    return content;
  }

  // 创建工具名称到引用索引的映射
  const toolToIndex = new Map<string, number>();
  citations.forEach(c => {
    toolToIndex.set(c.toolName.toLowerCase(), c.index);
    if (c.mcpServer) {
      toolToIndex.set(`${c.mcpServer}-${c.toolName}`.toLowerCase(), c.index);
      toolToIndex.set(`mcp-${c.mcpServer}-${c.toolName}`.toLowerCase(), c.index);
    }
  });

  // 匹配工具调用的模式
  // 支持格式: list_devices, MCP-list_devices, mcp-server-tool 等
  const patterns = citations.map(c => {
    const escapedName = c.toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (c.mcpServer) {
      const escapedServer = c.mcpServer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `(?:mcp-)?(?:${escapedServer}-)?${escapedName}`;
    }
    return `(?:mcp-)?${escapedName}`;
  }).join('|');

  if (!patterns) return content;

  const regex = new RegExp(`\\b(${patterns})\\b`, 'gi');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // 添加匹配前的文本
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }

    // 查找对应的引用索引
    const matchedText = match[1];
    let citationIndex: number | undefined;
    
    // 尝试找到匹配的工具
    for (const [key, idx] of toolToIndex.entries()) {
      if (matchedText.toLowerCase().includes(key) || key.includes(matchedText.toLowerCase())) {
        citationIndex = idx;
        break;
      }
    }

    // 添加带引用标记的文本
    if (citationIndex !== undefined) {
      parts.push(
        <span key={`citation-${match.index}`} className="mcp-citation-inline">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{matchedText}</span>
          <sup className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/50 px-1 py-0.5 rounded ml-0.5">
            [{citationIndex}]
          </sup>
        </span>
      );
    } else {
      parts.push(
        <span key={`tool-${match.index}`} className="font-semibold text-gray-700 dark:text-gray-300">
          {matchedText}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : content;
};

/** 思考过程区块组件 - 扁平化设计，虚线边框 */
const ThinkingBlock: React.FC<{
  content: string;
  index?: number;
  isExpanded: boolean;
  onToggle: () => void;
  isThinking?: boolean;
  mcpCitations?: MCPCitation[];
}> = ({ content, index, isExpanded, onToggle, isThinking, mcpCitations = [] }) => (
  <div className="border-l-2 border-dashed border-purple-300 dark:border-purple-700 pl-3 py-1">
    {/* 标题行 */}
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors py-1 -ml-1 pl-1 rounded"
    >
      <div className="flex items-center space-x-2">
        <Lightbulb className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
        <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
          思考过程 {index !== undefined && index > 0 ? `#${index + 1}` : ''}
        </span>
        {mcpCitations.length > 0 && (
          <span className="text-[10px] text-emerald-500 dark:text-emerald-400">
            (引用 {mcpCitations.length} 个工具)
          </span>
        )}
        {isThinking && (
          <span className="flex items-center space-x-1">
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-purple-500 dark:text-purple-400">思考中...</span>
          </span>
        )}
      </div>
      {isExpanded ? (
        <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
      ) : (
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      )}
    </button>
    
    {isExpanded && content && (
      <div className="mt-2 pl-1">
        <div className="text-[11px] text-gray-600 dark:text-gray-400 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto thinking-gradient bg-purple-50/50 dark:bg-purple-900/10 p-2 rounded border-l border-purple-200 dark:border-purple-700">
          {renderThinkingWithCitations(content, mcpCitations)}
        </div>
        
        {/* 引用列表（如果有） */}
        {mcpCitations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-dashed border-purple-200 dark:border-purple-800">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">引用的工具:</div>
            <div className="flex flex-wrap gap-1">
              {mcpCitations.map(c => (
                <span 
                  key={c.index}
                  className="inline-flex items-center text-[9px] px-1.5 py-0.5 bg-emerald-100/60 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded"
                >
                  <span className="font-bold mr-1">[{c.index}]</span>
                  {c.mcpServer ? `${c.mcpServer}-` : ''}{c.toolName}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    )}
  </div>
);

/** 格式化 JSON/对象数据用于显示 */
const formatData = (data: any, maxLength: number = 500): string => {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') {
    try {
      // 尝试解析 JSON 字符串
      const parsed = JSON.parse(data);
      const formatted = JSON.stringify(parsed, null, 2);
      return formatted.length > maxLength ? formatted.substring(0, maxLength) + '\n... (数据已截断)' : formatted;
    } catch {
      return data.length > maxLength ? data.substring(0, maxLength) + '... (数据已截断)' : data;
    }
  }
  const formatted = JSON.stringify(data, null, 2);
  return formatted.length > maxLength ? formatted.substring(0, maxLength) + '\n... (数据已截断)' : formatted;
};

/** MCP 调用区块组件 - 扁平化设计，虚线边框 */
const MCPCallBlock: React.FC<{
  mcpServer?: string;
  toolName?: string;
  call?: any;
  result?: any;
  status?: 'pending' | 'running' | 'completed' | 'error';
  duration?: number;
  index?: number;
  citationIndex?: number;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ mcpServer, toolName, call, result, status, duration, index, citationIndex, isExpanded, onToggle }) => {
  // 生成引用标识
  const citationLabel = citationIndex !== undefined ? `[${citationIndex}]` : '';
  const displayName = `${mcpServer ? `mcp-${mcpServer}` : 'MCP'}-${toolName || 'tool'}`;
  
  return (
    <div className="border-l-2 border-dashed border-emerald-300 dark:border-emerald-700 pl-3 py-1 mcp-call-block" data-citation={citationIndex}>
      {/* 标题行 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-colors py-1 -ml-1 pl-1 rounded"
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <Plug className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          {/* 引用标识 */}
          {citationLabel && (
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100/60 dark:bg-emerald-900/40 px-1 py-0.5 rounded flex-shrink-0">
              {citationLabel}
            </span>
          )}
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 truncate">
            {displayName}
          </span>
          {status === 'pending' && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">等待中</span>
          )}
          {status === 'running' && (
            <span className="flex items-center space-x-1 flex-shrink-0">
              <Loader className="w-3 h-3 text-emerald-500 animate-spin" />
              <span className="text-[10px] text-emerald-500">执行中</span>
            </span>
          )}
          {status === 'completed' && (
            <span className="flex items-center space-x-1 flex-shrink-0">
              <CheckCircle className="w-3 h-3 text-green-500" />
              <span className="text-[10px] text-green-500">{duration ? `${duration}ms` : '完成'}</span>
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center space-x-1 flex-shrink-0">
              <AlertCircle className="w-3 h-3 text-red-500" />
              <span className="text-[10px] text-red-500">失败</span>
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
      </button>
      
      {isExpanded && (
        <div className="mt-2 space-y-2 text-[11px]">
          {/* 调用参数 */}
          <div className="pl-1">
            <div className="flex items-center space-x-1 mb-1 text-gray-500 dark:text-gray-400">
              <Wrench className="w-3 h-3" />
              <span className="text-[10px] font-medium">调用参数</span>
            </div>
            <div className="text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto bg-gray-50/50 dark:bg-gray-900/30 p-2 rounded border-l border-gray-200 dark:border-gray-700">
              {call ? formatData(call, 2000) : <span className="text-gray-400 italic">无参数</span>}
            </div>
          </div>
          
          {/* 返回结果 */}
          <div className="pl-1">
            <div className={`flex items-center space-x-1 mb-1 ${
              status === 'error' ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'
            }`}>
              <ArrowRight className="w-3 h-3" />
              <span className="text-[10px] font-medium">返回结果</span>
            </div>
            <div className={`font-mono whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto p-2 rounded border-l ${
              status === 'error' 
                ? 'bg-red-50/50 dark:bg-red-900/10 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300'
                : 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-300 dark:border-emerald-700 text-gray-700 dark:text-gray-300'
            }`}>
              {result ? formatData(result, 5000) : (
                status === 'running' ? (
                  <span className="text-emerald-500 italic flex items-center space-x-1">
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>等待返回...</span>
                  </span>
                ) : status === 'pending' ? (
                  <span className="text-gray-400 italic">等待执行</span>
                ) : (
                  <span className="text-gray-400 italic">无返回数据</span>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** 工作流区块组件 */
const WorkflowBlock: React.FC<{
  workflowInfo: WorkflowInfo;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ workflowInfo, isExpanded, onToggle }) => (
  <div className="bg-white dark:bg-[#252525] rounded-lg border border-gray-200 dark:border-[#404040] overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-[#2d2d2d] transition-colors"
    >
      <div className="flex items-center space-x-2">
        <div className="p-1 bg-indigo-100 dark:bg-indigo-900/30 rounded">
          <WorkflowIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          工作流: {workflowInfo.name || '执行过程'}
        </span>
        {workflowInfo.status === 'running' && (
          <Loader className="w-3 h-3 text-indigo-500 animate-spin" />
        )}
        {workflowInfo.status === 'completed' && (
          <CheckCircle className="w-3 h-3 text-green-500" />
        )}
        {workflowInfo.status === 'error' && (
          <AlertCircle className="w-3 h-3 text-red-500" />
        )}
      </div>
      {isExpanded ? (
        <ChevronUp className="w-4 h-4 text-gray-400" />
      ) : (
        <ChevronDown className="w-4 h-4 text-gray-400" />
      )}
    </button>
    
    {isExpanded && (
      <div className="px-3 pb-3 border-t border-gray-100 dark:border-[#333]">
        {/* 工作流状态 */}
        <div className="mt-2 flex items-center space-x-2">
          <span className={`text-[10px] px-2 py-0.5 rounded ${
            workflowInfo.status === 'pending' ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' :
            workflowInfo.status === 'running' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' :
            workflowInfo.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
            'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
          }`}>
            {workflowInfo.status === 'pending' ? '待执行' :
             workflowInfo.status === 'running' ? '执行中' :
             workflowInfo.status === 'completed' ? '已完成' : '执行失败'}
          </span>
        </div>
        
        {/* 工作流节点信息 */}
        {workflowInfo.config?.nodes && workflowInfo.config.nodes.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">节点列表:</div>
            {workflowInfo.config.nodes.slice(0, 5).map((node) => (
              <div 
                key={node.id} 
                className="flex items-center space-x-2 text-[10px] text-gray-600 dark:text-gray-400"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="font-medium">{node.type}</span>
                {node.data.label && (
                  <span className="text-gray-400">- {node.data.label}</span>
                )}
              </div>
            ))}
            {workflowInfo.config.nodes.length > 5 && (
              <div className="text-[10px] text-gray-400">
                ... 还有 {workflowInfo.config.nodes.length - 5} 个节点
              </div>
            )}
          </div>
        )}
        
        {/* 工作流结果 */}
        {workflowInfo.result && (
          <div className="mt-2 p-2 bg-gray-50 dark:bg-[#1e1e1e] rounded border border-gray-200 dark:border-[#333]">
            <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">执行结果:</div>
            <div className="text-[10px] text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
              {workflowInfo.result.substring(0, 2000)}
              {workflowInfo.result.length > 2000 && '...'}
            </div>
          </div>
        )}
      </div>
    )}
  </div>
);

export const MessageSidePanel: React.FC<MessageSidePanelProps> = ({
  thinking,
  isThinking,
  mcpDetail,
  toolCalls,
  workflowInfo,
  currentStep,
  isStreaming,
  thoughtSignature,
  hasContent = false,
  messageHeight,
  processSteps,
}) => {
  // 将旧接口数据转换为统一的过程步骤格式
  const buildProcessSteps = (): ProcessStep[] => {
    // 如果有新的 processSteps 数据，直接使用
    if (processSteps && processSteps.length > 0) {
      // 去重：合并所有思考步骤为一个（避免重复显示）
      const thinkingSteps = processSteps.filter(s => s.type === 'thinking');
      const otherSteps = processSteps.filter(s => s.type !== 'thinking');
      
      // 如果有多个思考步骤，合并为一个（保留最长的内容）
      if (thinkingSteps.length > 1) {
        const mergedThinking = thinkingSteps.reduce((longest, current) => {
          const currentLen = current.thinking?.length || 0;
          const longestLen = longest.thinking?.length || 0;
          return currentLen > longestLen ? current : longest;
        });
        return [mergedThinking, ...otherSteps];
      }
      
      return processSteps;
    }

    // 否则从旧接口数据构建
    const steps: ProcessStep[] = [];

    // 添加思考过程
    if (thinking && thinking.trim()) {
      steps.push({
        type: 'thinking',
        thinking: thinking,
      });
    }

    // 添加 MCP 调用（从 mcpDetail）
    // 兼容两种 MCPDetail 结构：
    // 1) 旧结构：tool_calls/tool_results（OpenAI tool calls）
    // 2) 新结构：execution 记录（raw_result/logs/component_type）
    const legacyToolCalls = (mcpDetail as any)?.tool_calls;
    if (Array.isArray(legacyToolCalls) && legacyToolCalls.length > 0) {
      legacyToolCalls.forEach((call: any, index: number) => {
        const result = (mcpDetail as any)?.tool_results?.[index];
        steps.push({
          type: 'mcp_call',
          toolName: call?.function?.name || call?.name || 'unknown',
          arguments: call?.function?.arguments ?? call?.arguments,
          result: result?.content ?? result,
          status: 'completed',
        });
      });
    } else if (mcpDetail && (mcpDetail as any).component_type === 'mcp') {
      const raw = (mcpDetail as any).raw_result;
      const results = raw?.results;
      if (Array.isArray(results) && results.length > 0) {
        // 按结果拆成多个 MCP 调用块（尽量贴近现有 MCP UX）
        results.forEach((r: any) => {
          const toolName = r?.tool ? String(r.tool) : r?.name ? String(r.name) : 'unknown_tool';
          steps.push({
            type: 'mcp_call',
            toolName,
            arguments: r?.arguments ?? r?.args ?? r?.input,
            // 保留原始结构，MCPCallBlock 会做 stringify；保证用户能看到“内容”
            result: r?.result ?? r,
            status: (mcpDetail as any).status || (r?.status as any) || 'completed',
          });
        });
      } else if (raw) {
        // 兜底：没有 results 数组时，仍展示 raw_result
        steps.push({
          type: 'mcp_call',
          toolName: (mcpDetail as any).component_name || 'mcp',
          arguments: undefined,
          result: raw,
          status: (mcpDetail as any).status || 'completed',
        });
      }
    }

    // 添加 MCP 调用（从 toolCalls）
    if (toolCalls && Array.isArray(toolCalls)) {
      toolCalls.forEach((tc) => {
        // 避免重复添加
        const alreadyAdded = steps.some(s => 
          s.type === 'mcp_call' && s.toolName === tc.name
        );
        if (!alreadyAdded) {
          steps.push({
            type: 'mcp_call',
            toolName: tc.name,
            arguments: tc.arguments,
            result: tc.result,
            status: tc.result ? 'completed' : 'running',
          });
        }
      });
    }

    // 添加工作流
    if (workflowInfo && workflowInfo.status) {
      steps.push({
        type: 'workflow',
        workflowInfo: workflowInfo,
      });
    }
    // 兼容：如果 mcpDetail 是 workflow 类型的 execution 记录，也加入工作流步骤
    if (!workflowInfo && mcpDetail && (mcpDetail as any).component_type === 'workflow') {
      steps.push({
        type: 'workflow',
        workflowInfo: {
          id: (mcpDetail as any).component_id,
          name: (mcpDetail as any).component_name,
          status: (mcpDetail as any).status,
          result: (mcpDetail as any).raw_result ? formatData((mcpDetail as any).raw_result, 600) : undefined,
          config: undefined,
        },
      });
    }

    return steps;
  };

  const steps = buildProcessSteps();

  // 生成 MCP 调用的引用索引
  const mcpSteps = steps.filter(s => s.type === 'mcp_call');
  const mcpCitations: MCPCitation[] = mcpSteps.map((step, idx) => ({
    index: idx + 1, // 引用从 1 开始
    toolName: step.toolName || 'unknown',
    mcpServer: step.mcpServer,
  }));

  // 默认展开所有块（MCP 调用块默认展开）
  const getDefaultExpanded = (): Set<string> => {
    const expanded = new Set<string>();
    steps.forEach((step, index) => {
      const blockId = `${step.type}-${index}`;
      // 默认展开第一个思考过程、所有 MCP 调用、第一个工作流
      if (step.type === 'thinking' && steps.filter(s => s.type === 'thinking').indexOf(step) === 0) {
        expanded.add(blockId);
      }
      if (step.type === 'mcp_call') {
        expanded.add(blockId); // MCP 调用默认全部展开
      }
      if (step.type === 'workflow' && steps.filter(s => s.type === 'workflow').indexOf(step) === 0) {
        expanded.add(blockId);
      }
    });
    return expanded;
  };

  // 每个区块的展开状态
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(getDefaultExpanded);

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  // 检查是否有任何内容需要显示
  const hasAnyContent = steps.length > 0 || isThinking || currentStep || thoughtSignature;

  if (!hasAnyContent) {
    return null;
  }

  const panelStyle = messageHeight ? { minHeight: messageHeight } : {};
  // 旧版并排布局会给 messageHeight，从而允许面板填满高度（h-full）。
  // 现在堆叠布局通常没有固定高度，因此需要一个可见的最大高度，否则 h-full 可能为 0。
  // 增加默认高度以显示更多内容
  const scrollAreaHeightClass = messageHeight ? 'h-full' : 'max-h-[600px]';

  return (
    <ScrollArea 
      className={`${scrollAreaHeightClass} w-full bg-gray-50/50 dark:bg-[#1a1a1a]/50 rounded-lg border border-gray-200/50 dark:border-[#333]/50`}
      style={panelStyle}
    >
      <div className="p-3 space-y-3">
        {/* 当前执行步骤（实时状态） */}
        {currentStep && currentStep.trim() && (
          <div className="flex items-center space-x-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Loader className="w-3.5 h-3.5 text-blue-500 animate-spin" />
            <span className="text-xs text-blue-700 dark:text-blue-300">{currentStep}</span>
          </div>
        )}

        {/* 正在思考的指示器（如果没有内容但在思考中） */}
        {isThinking && steps.filter(s => s.type === 'thinking').length === 0 && (
          <div className="bg-white dark:bg-[#252525] rounded-lg border border-gray-200 dark:border-[#404040] p-3">
            <div className="flex items-center space-x-2">
              <div className="p-1 bg-purple-100 dark:bg-purple-900/30 rounded">
                <Lightbulb className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">思考过程</span>
              <div className="flex items-center space-x-1">
                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-purple-500 dark:text-purple-400">思考中...</span>
              </div>
            </div>
          </div>
        )}

        {/* 按顺序渲染所有过程步骤 */}
        {steps.map((step, index) => {
          const blockId = `${step.type}-${index}`;
          const isExpanded = expandedBlocks.has(blockId);

          switch (step.type) {
            case 'thinking':
              return (
                <ThinkingBlock
                  key={blockId}
                  content={step.thinking || ''}
                  index={steps.filter(s => s.type === 'thinking').indexOf(step)}
                  isExpanded={isExpanded}
                  onToggle={() => toggleBlock(blockId)}
                  isThinking={isThinking && index === steps.length - 1}
                  mcpCitations={mcpCitations}
                />
              );

            case 'mcp_call': {
              // 计算当前 MCP 调用的引用索引
              const mcpIndex = mcpSteps.indexOf(step);
              const citationIndex = mcpIndex >= 0 ? mcpIndex + 1 : undefined;
              return (
                <MCPCallBlock
                  key={blockId}
                  mcpServer={step.mcpServer}
                  toolName={step.toolName}
                  call={step.arguments}
                  result={step.result}
                  status={step.status}
                  duration={step.duration}
                  index={index}
                  citationIndex={citationIndex}
                  isExpanded={isExpanded}
                  onToggle={() => toggleBlock(blockId)}
                />
              );
            }

            case 'workflow':
              return step.workflowInfo ? (
                <WorkflowBlock
                  key={blockId}
                  workflowInfo={step.workflowInfo}
                  isExpanded={isExpanded}
                  onToggle={() => toggleBlock(blockId)}
                />
              ) : null;

            default:
              return null;
          }
        })}

        {/* 思维签名（用于 Gemini） */}
        {thoughtSignature && (
          <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800/30">
            <div className="flex items-center space-x-2 mb-1">
              <Brain className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">思维签名</span>
            </div>
            <div className="text-[10px] text-gray-600 dark:text-gray-400 font-mono truncate">
              {thoughtSignature.substring(0, 100)}...
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default MessageSidePanel;
