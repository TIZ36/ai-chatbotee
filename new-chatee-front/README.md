# New Chatee Frontend

基于 Next.js 14 的现代化社交聊天平台前端，接入 chatee-go 后端。

## 功能特性

### 1. 发布动态 (Thread)
- 发布新动态（支持标题和内容）
- 查看动态列表和详情
- 回复和嵌套回复
- 动态的点赞和分享

### 2. 关注系统
- 关注/取消关注用户
- 查看粉丝和关注列表
- 用户个人主页

### 3. 私聊功能
- 发起私聊对话
- 实时消息收发
- 未读消息计数
- 消息列表

## 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **数据获取**: SWR
- **图标**: Lucide React
- **工具**: clsx, tailwind-merge, date-fns

## 项目结构

```
new-chatee-front/
├── src/
│   ├── app/                    # Next.js App Router 页面
│   │   ├── layout.tsx          # 根布局
│   │   ├── page.tsx            # 首页
│   │   ├── login/              # 登录页
│   │   ├── threads/            # 动态列表
│   │   ├── thread/[id]/        # 动态详情
│   │   ├── chat/               # 私聊列表
│   │   ├── chat/[id]/          # 私聊窗口
│   │   ├── profile/[id]/       # 用户主页
│   │   └── settings/           # 设置页面
│   │
│   ├── components/
│   │   ├── ui/                 # 基础 UI 组件
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Textarea.tsx
│   │   │   ├── Avatar.tsx
│   │   │   └── Modal.tsx
│   │   │
│   │   ├── layout/             # 布局组件
│   │   │   ├── Sidebar.tsx
│   │   │   ├── MobileNav.tsx
│   │   │   └── MainLayout.tsx
│   │   │
│   │   ├── thread/             # 动态相关组件
│   │   │   ├── ThreadCard.tsx
│   │   │   ├── ThreadList.tsx
│   │   │   ├── CreateThreadModal.tsx
│   │   │   └── ReplyItem.tsx
│   │   │
│   │   ├── user/               # 用户相关组件
│   │   │   ├── FollowButton.tsx
│   │   │   ├── FollowListModal.tsx
│   │   │   └── UserProfileCard.tsx
│   │   │
│   │   └── chat/               # 私聊相关组件
│   │       ├── ChatList.tsx
│   │       ├── ChatListItem.tsx
│   │       ├── ChatWindow.tsx
│   │       ├── ChatMessageItem.tsx
│   │       └── CreateChatModal.tsx
│   │
│   └── lib/
│       ├── api.ts              # API 客户端
│       ├── types.ts            # TypeScript 类型定义
│       ├── store.ts            # Zustand 状态管理
│       ├── websocket.ts        # WebSocket 客户端
│       └── utils.ts            # 工具函数
│
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.mjs
```

## 快速开始

### 安装依赖

```bash
cd new-chatee-front
npm install
```

### 配置环境变量

```bash
cp .env.local.example .env.local
# 编辑 .env.local 设置后端地址
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:3000

### 生产构建

```bash
npm run build
npm run start
```

## API 接入

前端通过 `next.config.mjs` 配置了 API 代理：

- `/api/*` → `http://localhost:8080/api/*` (HTTP API)
- `/ws/*` → `http://localhost:8081/ws/*` (WebSocket)

### 主要 API 端点

#### 认证
- `POST /api/v1/auth/login` - 登录
- `POST /api/v1/auth/logout` - 登出

#### 动态 (Thread)
- `POST /api/v1/threads` - 创建动态
- `GET /api/v1/threads` - 获取动态列表
- `GET /api/v1/threads/:id` - 获取动态详情
- `POST /api/v1/threads/:id/replies` - 发布回复
- `GET /api/v1/threads/:id/replies` - 获取回复列表

#### 用户
- `GET /api/v1/users/:id` - 获取用户信息
- `PUT /api/v1/users/:id` - 更新用户信息
- `POST /api/v1/users/:id/follow` - 关注用户
- `DELETE /api/v1/users/:id/follow` - 取消关注
- `GET /api/v1/users/:id/followers` - 获取粉丝列表
- `GET /api/v1/users/:id/following` - 获取关注列表

#### 私聊 (Chat)
- `POST /api/v1/chats` - 创建私聊
- `GET /api/v1/chats` - 获取私聊列表
- `GET /api/v1/chats/:id` - 获取私聊详情
- `POST /api/v1/chats/:id/messages` - 发送消息
- `GET /api/v1/chats/:id/messages` - 获取消息列表

## 功能截图

### 首页 / 动态列表
- 展示关注用户的动态
- 支持发布新动态
- 回复和互动

### 私聊
- 左侧对话列表
- 右侧聊天窗口
- 实时消息推送

### 用户主页
- 用户资料卡片
- 关注/粉丝统计
- 用户发布的动态

## 开发注意事项

1. **状态管理**: 使用 Zustand 管理全局状态，包括用户认证、动态列表、私聊列表等

2. **实时通信**: 通过 WebSocket 实现消息实时推送

3. **响应式设计**: 支持桌面端和移动端，移动端使用底部导航

4. **演示模式**: 登录页面提供"演示账号登录"功能，便于开发测试

## License

MIT
