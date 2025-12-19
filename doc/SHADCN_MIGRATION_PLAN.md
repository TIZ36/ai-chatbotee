# Shadcn UI 渐进迁移计划（最小可用版）

> 适用范围：`src/` React + TS + Tailwind 聊天/工作流产品  
> 目标周期：1–2 周完成“基件统一 + 高频界面收口”，不触碰高风险复杂模块。

---

## 1. 目标（Goals）
- 统一全局基础组件与交互模式，降低 UI 碎片化。
- 提升聊天类产品的可用性一致性（表单、弹窗、侧边栏、提示、菜单等）。
- 让后续功能迭代能复用标准基件、减少重复造轮子。

## 2. 非目标（Non-goals）
- 不重做信息架构/业务逻辑。
- 不改 `WorkflowEditor`、`TerminalPanel`、可视化模块的核心交互。
- 不做全量视觉重设计，只做“基件 + 高频界面”收口。

---

## 3. 现状与适配点
- 已使用 Tailwind → shadcn 默认栈（Tailwind + Radix）天然匹配。
- 自研组件多、交互范式不一 → 需要标准化“基件与容器”。
- TS 严格模式 → shadcn 类型与可控性良好（代码落仓库内可精调）。

---

## 4. 基础设施与目录约定

### 4.1 引入与初始化
- 使用 shadcn 官方 init（含 Radix、CVA、tailwind-merge）。
- 生成组件统一放置在：`src/components/ui/`

### 4.2 设计 Token 对齐（最小集）
在 `src/index.css` 建立 CSS 变量并映射 Tailwind：
- 色彩：`--background --foreground --primary --muted --border --destructive`
- 圆角：`--radius`
- 阴影/层级：`--shadow-sm/md/lg`
- 动效：`--duration-fast/normal`

> 原则：先对齐“中性色 + 主色 + 危险色 + 圆角/间距密度”，避免默认灰蓝风格渗透。

---

## 5. 组件优先级表（按影响面/风险/收益排序）

| 优先级 | 组件 | 价值/原因 | 主要落点文件（示例） | 工作量 | 风险 |
|---|---|---|---|---|---|
| P0 | `Button` | 全局交互基件，统一尺寸/层级/禁用态 | `src/components/Workflow.tsx`, `src/components/LLMConfig.tsx`, `src/components/MCPConfig.tsx`, `src/components/SettingsPanel.tsx`, `src/components/Crawler*.tsx` | S | 低 |
| P0 | `Input / Textarea / Label` | 表单与聊天输入一致性 | 同上 + 聊天输入区 | S | 低 |
| P0 | `Toast / Alert` | 全局反馈统一，提升可理解性 | 配置保存/工作流执行/工具调用/爬虫 | M | 低 |
| P1 | `Dialog` | 统一确认/编辑/新建弹窗，键盘无障碍 | 删除/编辑/新建场景广泛分布 | M | 低 |
| P1 | `Sheet / Popover` | 侧边抽屉与浮层一致 | 设置面板、工具参数、快捷配置 | M | 低 |
| P1 | `Select / DropdownMenu` | 统一下拉/菜单交互 | 配置选择、列表项菜单 | M | 低 |
| P1 | `Checkbox / Switch` | 表单开关统一 | LLM/MCP/爬虫配置 | S | 低 |
| P2 | `Tabs / Accordion` | 多面板切换/折叠一致 | Settings/Config 分区、参数组 | S–M | 低 |
| P2 | `Badge / Separator / Skeleton / Progress` | 状态/分组/加载与长任务可视化 | 工作流运行、爬虫批任务、侧栏加载 | S | 低 |

---

## 6. 文件级替换顺序（建议）

### Sprint 0（半天）
1. 引入 shadcn 基础设施与目录约定
2. Token 对齐与全局样式基线

### Sprint 1（2–3 天）：基件替换（P0）
1. `src/components/ui/Button.tsx`
2. `src/components/ui/Input.tsx`
3. `src/components/ui/Textarea.tsx`
4. `src/components/ui/Label.tsx`
5. `src/components/ui/Toast.tsx` + 全局 Toast Provider
6. 全局替换触达文件：  
   - `src/components/Workflow.tsx`（聊天输入区+发送按钮+附件/工具按钮）
   - `src/components/LLMConfig.tsx`
   - `src/components/MCPConfig.tsx`
   - `src/components/SettingsPanel.tsx`
   - `src/components/Crawler*.tsx`

### Sprint 2（2–4 天）：容器与反馈（P1）
1. `src/components/ui/Dialog.tsx`
2. `src/components/ui/Sheet.tsx` 或 `Popover.tsx`
3. `src/components/ui/Select.tsx`
4. `src/components/ui/DropdownMenu.tsx`
5. `src/components/ui/Checkbox.tsx`、`Switch.tsx`
6. 替换落点：  
   - `src/components/SessionSidebar.tsx`（菜单/删除确认/列表项交互）
   - 配置区的新增/编辑/删除弹窗
   - 工具调用参数编辑区（如有）

### Sprint 3（1–2 天）：高频界面收口（P2）
1. `Tabs / Accordion / Badge / Skeleton / Progress`
2. 只做样式与交互一致性收口，不动业务逻辑：  
   - 聊天输入区  
   - 会话侧栏  
   - LLM/MCP 配置表单

---

## 7. 暂不迁移的模块（高风险区）
- `src/components/WorkflowEditor.tsx`（拖拽/复杂编辑器）
- `src/components/TerminalPanel.tsx`（xterm 深度定制）
- `src/components/visualization/*`（可视化）

> 等基件稳定后再评估是否局部改造（例如只替换按钮/菜单层）。

---

## 8. 验收标准（Definition of Done）
- `src/components/ui/` 中落地至少 P0+P1 组件。
- 高频界面 3 处完成替换与收口：  
  1) 聊天输入区  
  2) 会话侧栏  
  3) LLM/MCP 配置表单
- 视觉/交互一致性提升：按钮密度、表单间距、弹窗/抽屉/菜单风格统一。
- 无业务逻辑回归（保存配置、发送消息、执行工作流、侧栏会话切换）。

---

## 9. 回归与测试清单（手动）
1. 启动前端 + 后端 + Electron
2. 基础 UI：  
   - 按钮 hover/disabled/loading 状态  
   - 输入框校验/placeholder/错误态  
   - 弹窗/抽屉开合、ESC 关闭、焦点回退  
   - 菜单/下拉键盘导航
3. 高频流程：  
   - 新建/编辑/删除工作流  
   - LLM/MCP 配置保存与重新加载  
   - 聊天发送、工具调用、长任务提示  
   - 会话侧栏切换/删除确认

---

## 10. 风险与对策
- 风险：默认主题“灰蓝化”  
  对策：Sprint 0 先做 Token 对齐再替换。
- 风险：大范围替换带来 UI 细节回归  
  对策：按优先级分批替换、每批完成即回归。
- 风险：shadcn 版本更新不自动  
  对策：只在需要时手动挑选组件 patch；不追最新。

---

## 11. 下一步需要确认的问题
- 品牌主色/中性色/危险色的最终 Token 值？
- 按钮密度（default/small/compact）与字体体系是否要统一？
- 高频界面是否需要暗色模式（若需要，Token 先预留）？

