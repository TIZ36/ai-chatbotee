# ActionChain 系统迁移指南

## 概述

本次迁移将旧的 `Action` 系统替换为新的 `ActionChain` 系统，提供更丰富的 Agent 协作能力。

## 核心变更

### 1. 新的枚举类型

旧系统使用字符串类型（'mcp', 'skill', 'tool', 'llm'），新系统使用枚举：

```python
class AgentActionType(str, Enum):
    AG_ACCEPT = 'ag_accept'           # 接受处理
    AG_REFUSE = 'ag_refuse'           # 拒绝处理（触发中断）
    AG_SELF_GEN = 'ag_self_gen'       # 自行生成内容
    AG_SELF_DECISION = 'ag_self_decision'  # 自主决策
    AG_USE_MCP = 'ag_use_mcp'         # 调用 MCP 工具
    AG_CALL_AG = 'ag_call_ag'         # 调用其他 Agent
    AG_CALL_HUMAN = 'ag_call_human'   # 需要人类介入
```

### 2. ActionStep 替代 Action

| 旧 Action 字段 | 新 ActionStep 字段 | 说明 |
|---------------|-------------------|------|
| `type` | `action_type` | 使用 AgentActionType 枚举 |
| `server_id` | `mcp_server_id` | MCP 服务器 ID |
| `tool_name` / `mcp_tool_name` | `mcp_tool_name` | MCP 工具名称 |
| `params` | `params` | 参数（不变） |
| `skill_id` | `skill_id` | Skill ID（不变） |
| - | `target_agent_id` | 目标 Agent ID（AG_CALL_AG 用） |
| - | `target_topic_id` | 目标 Topic ID（AG_CALL_AG 用） |

### 3. ActionResult 变更

| 旧字段 | 新字段 |
|-------|-------|
| `action` | `step` |

### 4. 工厂函数

旧方式：
```python
action = Action.mcp(server_id="xxx", tool_name="yyy", params={})
```

新方式：
```python
step = create_mcp_step(mcp_server_id="xxx", mcp_tool_name="yyy", params={})
```

### 5. 方法签名变更

```python
# 旧
def _call_mcp(self, action: Action, ctx: IterationContext) -> ActionResult:

# 新
def _call_mcp(self, step: ActionStep, ctx: IterationContext) -> ActionResult:
```

同样适用于 `_call_skill` 和 `_call_tool`。

## 文件结构

```
services/actor/
├── action_chain.py     # 新系统核心（ActionStep, ActionChain, ActionResult, ResponseDecision）
├── actions.py          # 兼容层（导入并重新导出 action_chain 内容）
├── actor_base.py       # 已更新使用新系统
├── iteration_context.py # 类型注解已更新
└── __init__.py         # 导出更新
```

## 兼容性

`actions.py` 作为兼容层保留，提供以下别名：

```python
Action = ActionStep  # 别名
ActionType = AgentActionType  # 已废弃别名

# 旧工厂函数仍可用
MCPAction(server_id, tool_name, params)  # 内部调用 create_mcp_step
SkillAction(skill_id, params)
ToolAction(tool_name, params)
LLMAction(prompt)
```

## 新增功能

### ActionChain

多步骤执行链，支持：
- Redis 持久化（TTL=3600s）
- 中断检测
- 进度追踪
- Agent 间传递

### 中断 API

```
POST /api/topics/{session_id}/interrupt
Body: {"agent_id": "optional_agent_id", "reason": "用户中断"}
```

### 事件类型

新增 TopicEventType：
- `ACTION_STEP_START`
- `ACTION_STEP_DONE`
- `ACTION_CHAIN_PROGRESS`
- `ACTION_CHAIN_INTERRUPT`

## 迁移检查清单

- [x] ActionStep 替代 Action
- [x] ActionResult.step 替代 ActionResult.action
- [x] create_mcp_step 替代 Action.mcp
- [x] _call_mcp 签名更新
- [x] _call_skill 签名更新
- [x] _call_tool 签名更新
- [x] _plan_actions 返回类型更新
- [x] iteration_context 类型注解更新
- [x] 所有文件语法验证通过
