"""
能力注册表

管理 Agent 可用的能力：
- MCP 服务器/工具
- Skill（技能包）
- 内置工具
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .actions import Action

logger = logging.getLogger(__name__)


@dataclass
class MCPCapability:
    """MCP 能力"""
    server_id: str
    name: str
    url: str
    enabled: bool = True
    use_proxy: bool = True
    description: str = ""
    tools: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def get_tool_names(self) -> List[str]:
        """获取工具名称列表"""
        return [t.get('name', '') for t in self.tools if t.get('name')]
    
    def get_tool_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """根据名称获取工具"""
        for t in self.tools:
            if t.get('name') == name:
                return t
        return None
    
    def to_description(self) -> str:
        """转换为描述文本（用于 LLM）"""
        tools_desc = ", ".join(self.get_tool_names()[:10])
        if len(self.tools) > 10:
            tools_desc += f" 等 {len(self.tools)} 个工具"
        return f"{self.name}: {self.description or '无描述'} [工具: {tools_desc}]"


@dataclass
class SkillCapability:
    """Skill 能力"""
    skill_id: str
    name: str
    description: str = ""
    trigger_keywords: List[str] = field(default_factory=list)
    
    # Skill 包含的步骤
    steps: List[Dict[str, Any]] = field(default_factory=list)
    
    # 执行函数（如果是代码定义的 Skill）
    execute_fn: Optional[Callable] = None
    
    # 所需的 MCP/Tool
    required_mcps: List[str] = field(default_factory=list)
    required_tools: List[str] = field(default_factory=list)
    
    def to_description(self) -> str:
        """转换为描述文本"""
        keywords = ", ".join(self.trigger_keywords[:5]) if self.trigger_keywords else "无"
        return f"{self.name}: {self.description or '无描述'} [触发词: {keywords}]"


@dataclass
class ToolCapability:
    """内置工具能力"""
    tool_name: str
    description: str = ""
    
    # 执行函数
    execute_fn: Callable = None
    
    # 参数 schema
    parameters: Dict[str, Any] = field(default_factory=dict)
    
    def to_description(self) -> str:
        """转换为描述文本"""
        return f"{self.tool_name}: {self.description or '无描述'}"


class CapabilityRegistry:
    """
    能力注册表
    
    管理 Agent 的所有可用能力
    """
    
    def __init__(self):
        # MCP 服务器
        self._mcp_servers: Dict[str, MCPCapability] = {}
        
        # Skill
        self._skills: Dict[str, SkillCapability] = {}
        
        # 内置工具
        self._tools: Dict[str, ToolCapability] = {}
        
        # 缓存
        self._capability_description_cache: Optional[str] = None
    
    # ==================== MCP 管理 ====================
    
    def register_mcp(
        self,
        server_id: str,
        name: str,
        url: str,
        enabled: bool = True,
        use_proxy: bool = True,
        description: str = "",
        tools: List[Dict[str, Any]] = None,
        metadata: Dict[str, Any] = None,
    ):
        """
        注册 MCP 服务器
        
        Args:
            server_id: 服务器 ID
            name: 名称
            url: URL
            enabled: 是否启用
            use_proxy: 是否使用代理
            description: 描述
            tools: 工具列表
            metadata: 元数据
        """
        self._mcp_servers[server_id] = MCPCapability(
            server_id=server_id,
            name=name,
            url=url,
            enabled=enabled,
            use_proxy=use_proxy,
            description=description,
            tools=tools or [],
            metadata=metadata or {},
        )
        self._invalidate_cache()
    
    def register_mcp_from_dict(self, server_dict: Dict[str, Any]):
        """从字典注册 MCP"""
        self.register_mcp(
            server_id=server_dict.get('server_id'),
            name=server_dict.get('name', ''),
            url=server_dict.get('url', ''),
            enabled=server_dict.get('enabled', True),
            use_proxy=server_dict.get('use_proxy', True),
            description=server_dict.get('description', ''),
            tools=server_dict.get('tools', []),
            metadata=server_dict.get('metadata', {}),
        )
    
    def get_mcp(self, server_id: str) -> Optional[MCPCapability]:
        """获取 MCP 服务器"""
        return self._mcp_servers.get(server_id)
    
    def get_mcp_tool(self, server_id: str, tool_name: str) -> Optional[Dict[str, Any]]:
        """获取 MCP 工具"""
        mcp = self.get_mcp(server_id)
        if mcp:
            return mcp.get_tool_by_name(tool_name)
        return None
    
    def get_available_mcps(self) -> List[MCPCapability]:
        """获取所有可用的 MCP"""
        return [m for m in self._mcp_servers.values() if m.enabled]
    
    def get_all_mcp_tools(self) -> List[Dict[str, Any]]:
        """获取所有 MCP 工具（带服务器信息）"""
        all_tools = []
        for mcp in self.get_available_mcps():
            for tool in mcp.tools:
                all_tools.append({
                    'server_id': mcp.server_id,
                    'server_name': mcp.name,
                    **tool,
                })
        return all_tools
    
    # ==================== Skill 管理 ====================
    
    def register_skill(
        self,
        skill_id: str,
        name: str,
        description: str = "",
        trigger_keywords: List[str] = None,
        steps: List[Dict[str, Any]] = None,
        execute_fn: Callable = None,
        required_mcps: List[str] = None,
        required_tools: List[str] = None,
    ):
        """
        注册 Skill
        
        Args:
            skill_id: Skill ID
            name: 名称
            description: 描述
            trigger_keywords: 触发关键词
            steps: 执行步骤
            execute_fn: 执行函数
            required_mcps: 所需 MCP
            required_tools: 所需工具
        """
        self._skills[skill_id] = SkillCapability(
            skill_id=skill_id,
            name=name,
            description=description,
            trigger_keywords=trigger_keywords or [],
            steps=steps or [],
            execute_fn=execute_fn,
            required_mcps=required_mcps or [],
            required_tools=required_tools or [],
        )
        self._invalidate_cache()
    
    def get_skill(self, skill_id: str) -> Optional[SkillCapability]:
        """获取 Skill"""
        return self._skills.get(skill_id)
    
    def get_available_skills(self) -> List[SkillCapability]:
        """获取所有可用的 Skill"""
        return list(self._skills.values())
    
    def find_skill_by_keyword(self, text: str) -> Optional[SkillCapability]:
        """
        根据关键词匹配 Skill
        
        Args:
            text: 用户输入文本
            
        Returns:
            匹配的 Skill 或 None
        """
        if not text:
            return None
        
        text_lower = text.lower()
        for skill in self._skills.values():
            for keyword in skill.trigger_keywords:
                if keyword.lower() in text_lower:
                    return skill
        return None
    
    # ==================== 内置工具管理 ====================
    
    def register_tool(
        self,
        tool_name: str,
        execute_fn: Callable,
        description: str = "",
        parameters: Dict[str, Any] = None,
    ):
        """
        注册内置工具
        
        Args:
            tool_name: 工具名称
            execute_fn: 执行函数
            description: 描述
            parameters: 参数 schema
        """
        self._tools[tool_name] = ToolCapability(
            tool_name=tool_name,
            description=description,
            execute_fn=execute_fn,
            parameters=parameters or {},
        )
        self._invalidate_cache()
    
    def get_tool(self, tool_name: str) -> Optional[ToolCapability]:
        """获取内置工具"""
        return self._tools.get(tool_name)
    
    def get_available_tools(self) -> List[ToolCapability]:
        """获取所有可用的内置工具"""
        return list(self._tools.values())
    
    def execute_tool(self, tool_name: str, **params) -> Any:
        """
        执行内置工具
        
        Args:
            tool_name: 工具名称
            **params: 参数
            
        Returns:
            工具执行结果
        """
        tool = self.get_tool(tool_name)
        if not tool or not tool.execute_fn:
            raise ValueError(f"Tool not found or not callable: {tool_name}")
        
        return tool.execute_fn(**params)
    
    # ==================== 能力聚合 ====================
    
    def get_all_capabilities(self) -> Dict[str, List]:
        """
        获取所有能力
        
        Returns:
            {
                'mcp': [...],
                'skills': [...],
                'tools': [...],
            }
        """
        return {
            'mcp': self.get_available_mcps(),
            'skills': self.get_available_skills(),
            'tools': self.get_available_tools(),
        }
    
    def get_capability_description(self) -> str:
        """
        获取能力描述文本（用于 LLM system prompt）
        
        Returns:
            能力描述文本
        """
        if self._capability_description_cache:
            return self._capability_description_cache
        
        lines = []
        
        # MCP
        mcps = self.get_available_mcps()
        if mcps:
            lines.append("## 可用的 MCP 工具服务")
            for mcp in mcps:
                lines.append(f"- {mcp.to_description()}")
            lines.append("")
        
        # Skills
        skills = self.get_available_skills()
        if skills:
            lines.append("## 可用的技能包")
            for skill in skills:
                lines.append(f"- {skill.to_description()}")
            lines.append("")
        
        # Tools
        tools = self.get_available_tools()
        if tools:
            lines.append("## 可用的内置工具")
            for tool in tools:
                lines.append(f"- {tool.to_description()}")
            lines.append("")
        
        self._capability_description_cache = "\n".join(lines) if lines else ""
        return self._capability_description_cache
    
    def get_tools_for_llm(self) -> List[Dict[str, Any]]:
        """
        获取 LLM 工具调用格式的工具列表
        
        Returns:
            OpenAI tools 格式的列表
        """
        tools = []
        
        # MCP 工具
        for mcp in self.get_available_mcps():
            for t in mcp.tools:
                tools.append({
                    'type': 'function',
                    'function': {
                        'name': f"mcp_{mcp.server_id}_{t.get('name', '')}",
                        'description': t.get('description', ''),
                        'parameters': t.get('parameters', {'type': 'object', 'properties': {}}),
                    }
                })
        
        # 内置工具
        for tool in self.get_available_tools():
            tools.append({
                'type': 'function',
                'function': {
                    'name': tool.tool_name,
                    'description': tool.description,
                    'parameters': tool.parameters,
                }
            })
        
        return tools
    
    def has_any_capability(self) -> bool:
        """检查是否有任何能力"""
        return bool(self._mcp_servers or self._skills or self._tools)
    
    def clear(self):
        """清空所有能力"""
        self._mcp_servers.clear()
        self._skills.clear()
        self._tools.clear()
        self._invalidate_cache()
    
    def _invalidate_cache(self):
        """清除缓存"""
        self._capability_description_cache = None
    
    # ==================== 批量加载 ====================
    
    def load_from_topic_mcps(self, topic_mcp_configs: List[Dict[str, Any]]):
        """
        从 Topic MCP 配置加载
        
        Args:
            topic_mcp_configs: Topic 关联的 MCP 配置列表
        """
        for config in topic_mcp_configs:
            self.register_mcp_from_dict(config)
    
    def load_from_agent_config(self, agent_config: Dict[str, Any]):
        """
        从 Agent 配置加载
        
        Args:
            agent_config: Agent 配置
        """
        # 加载 MCP
        mcp_servers = agent_config.get('mcp_servers', [])
        for server in mcp_servers:
            self.register_mcp_from_dict(server)
        
        # 加载 Skills
        skills = agent_config.get('skills', [])
        for skill_conf in skills:
            self.register_skill(
                skill_id=skill_conf.get('skill_id'),
                name=skill_conf.get('name', ''),
                description=skill_conf.get('description', ''),
                trigger_keywords=skill_conf.get('trigger_keywords', []),
                steps=skill_conf.get('steps', []),
            )
