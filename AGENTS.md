# Repository Guidelines

## 项目结构与模块划分
- `src/`: React + TypeScript 前端。`components/` 功能面板（LLM/MCP 配置、工作流、终端）、`contexts/` 共享状态、`services/` API 调用、`utils/` 工具、`index.css` 全局样式，静态资源放 `assets/`。
- `electron/`: 主进程与 preload，TypeScript 编写，构建后输出 `.cjs` 至 `electron/dist`。
- `backend/`: Flask 服务（`app.py`、爬虫/数据库辅助、`config.yaml`）；使用本地 `venv/`。
- `scripts/` 与根目录 `start*.sh`: 启动脚本；`start.sh` 一键拉起后端 + Vite + Electron。

## 构建、测试与开发命令
- 前端：`npm install`，`npm run dev`（5174），`npm run build`（Vite + Electron TS），`npm run preview`。
- Electron：`npm run build:electron` 编译主进程/预加载；`npm run electron` 运行已编译版本；`npm run electron:dev` 同时跑 Vite + Electron；`npm run rebuild:electron` 重建 `node-pty`；`npm run build:all` 通过 electron-builder 打包。
- 后端：`cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python app.py`（3002）。`backend/start.sh` 先清理 3002 再启动。根目录 `./start.sh` 一站式启动并将日志写入 `/tmp`。

## 代码风格与命名规范
- TypeScript 严格模式：避免 `any`，保持明确的 props/返回类型，处理空值检查。
- 使用函数组件 + hooks；支持 `@/` 别名；组件文件用 `PascalCase`，工具/钩子用 `camelCase`。
- Tailwind 为主（`tailwind.config.js`）；保持类名可读并复用调色，通用样式放 `src/index.css`。
- 后端 Python 遵循 PEP 8、4 空格缩进；机密配置放 `config.yaml` 或环境变量，不要硬编码。

## 测试指南
- 当前无自动化套件；修改非 trivial 的 UI 逻辑时请补 Vitest/React Testing Library，变更 Flask 路由或数据层时补后端单测。
- 最低手动检查：启动后端(3002) + Vite(5174) + Electron，验证工作流创建、MCP/LLM 配置保存与加载、终端命令执行，并在 PR 中注明回归情况。

## 提交与 PR 规范
- 历史采用约定式提交（`feat:`、`chore:`、`fix:` 等），范围简洁、提交聚焦。
- PR 请附摘要、关联 issue/需求、手动测试记录，UI/流程改动附截图；后端 schema/配置变更需特别说明。

## 安全与配置提示
- 不要提交真实 API Key、数据库口令、Notion 凭据；`backend/config.yaml` 保留占位，本地自行覆盖。
- 默认端口：前端 5174、后端 3002、MySQL 3306、Redis 6379；如调整请同步文档。
- 手动启动时留意旧的 Vite/Electron/Python 进程以免端口冲突（脚本已自带清理）。 
