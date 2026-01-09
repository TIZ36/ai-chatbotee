# Chatee Go Backend

A distributed chat application backend written in Go, featuring Actor model architecture with ActionChain for AI agent orchestration.

## Architecture

```
                    ┌──────────────────┐
                    │   ChateeHttp     │  HTTP API Gateway
                    │   (Gin)          │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   ChateeSvr     │ │   ChateeConn    │ │   ChateeMsg     │
│   (Business)    │ │   (WebSocket)   │ │   (Messaging)   │
│   - Agent       │ │   - Hub         │ │   - Thread      │
│   - LLM         │ │   - Connection  │ │   - Chat        │
│   - MCP         │ │                 │ │   - Fanout      │
└────────┬────────┘ └─────────────────┘ └────────┬────────┘
         │                                       │
         └───────────────────┬───────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   ChateeDbc      │  Data Access Layer
                    │   (Repository)   │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
   ┌──────────┐        ┌──────────┐        ┌──────────┐
   │  MySQL   │        │  Redis   │        │  HBase   │
   │ (Config) │        │ (Cache)  │        │ (Msgs)   │
   └──────────┘        └──────────┘        └──────────┘
```

## Services

### ChateeHttp (HTTP API Gateway)
- RESTful API endpoints
- Authentication & authorization
- Request routing to backend services

### ChateeSvr (Business Logic)
- AI Agent management with Actor model
- ActionChain execution for complex workflows
- LLM provider integration (OpenAI, DeepSeek, etc.)
- MCP (Model Context Protocol) client

### ChateeConn (WebSocket Server)
- Real-time WebSocket connections
- Connection hub for message broadcasting
- User presence management

### ChateeMsg (Messaging Service)
- Thread-based (topic) messaging
- Private/Group chat messaging
- Write fanout for message delivery

### ChateeDbc (Data Access Layer)
- MySQL repository implementations
- Redis caching layer
- HBase integration for message storage

## Core Components

### Actor Model (`commonlib/actor/`)
- `Actor` interface for message processing
- `Mailbox` for asynchronous message delivery
- `ActorSystem` for actor lifecycle management
- `UserActor` for user connections
- `AIAgentActor` for AI agent behavior

### ActionChain (`commonlib/actor/action_chain.go`)
- Sequential action execution framework
- Action types: AG_SELF_GEN, AG_USE_MCP, AG_RAG, etc.
- ChainBuilder for fluent chain construction
- ChainExecutor with pluggable handlers

### MCP Client (`commonlib/mcp/`)
- JSON-RPC 2.0 implementation
- HTTP/SSE transport
- Tool listing and execution
- Server connection management

### LLM Providers (`commonlib/llm/`)
- Provider interface for multiple LLMs
- OpenAI-compatible client
- Streaming support
- Token counting

## Quick Start

### Prerequisites
- Go 1.22+
- MySQL 8.0+
- Redis 6.0+
- Make

### Setup

```bash
# Clone and enter directory
cd chatee-go

# Download dependencies
make deps

# Initialize database
make init

# Build all services
make build

# Run services (development)
make run-dbc   # Data access layer
make run-http  # HTTP API
make run-conn  # WebSocket
```

### Configuration

Copy and edit the configuration file:

```bash
cp configs/config.yaml configs/config.local.yaml
# Edit config.local.yaml with your settings
```

Environment variables for sensitive data:
- `CHATEE_MYSQL_PASSWORD`
- `CHATEE_REDIS_PASSWORD`
- `CHATEE_LLM_DEEPSEEK_API_KEY`
- `CHATEE_LLM_OPENAI_API_KEY`

## Project Structure

```
chatee-go/
├── commonlib/           # Shared libraries
│   ├── actor/          # Actor model
│   ├── config/         # Configuration
│   ├── llm/            # LLM providers
│   ├── log/            # Logging
│   ├── mcp/            # MCP client
│   ├── pool/           # Connection pools
│   └── snowflake/      # ID generation
├── configs/            # Configuration files
├── deployments/        # Docker & K8s
├── migrations/         # Database migrations
├── proto/              # Protobuf definitions
│   ├── common/         # Shared types
│   ├── dbc/            # Data layer
│   ├── msg/            # Messaging
│   ├── svr/            # Business logic
│   └── conn/           # WebSocket
└── services/           # Microservices
    ├── dbc_rpc/        # Data access (RPC)
    ├── chatee_http/    # HTTP API
    ├── conn_rpc/       # WebSocket (RPC)
    ├── im_rpc/         # Messaging (RPC)
    └── svr_rpc/        # Business (RPC)
```

## API Endpoints

### Sessions
- `POST /api/v1/sessions` - Create session
- `GET /api/v1/sessions/:id` - Get session
- `GET /api/v1/sessions/:id/messages` - Get messages

### Chat
- `POST /api/v1/chat/send` - Send message
- `POST /api/v1/chat/stream` - Stream response (SSE)

### Agents
- `POST /api/v1/agents` - Create agent
- `GET /api/v1/agents/:id` - Get agent
- `PUT /api/v1/agents/:id` - Update agent

### MCP
- `GET /api/v1/mcp/servers` - List servers
- `POST /api/v1/mcp/servers/:id/connect` - Connect
- `GET /api/v1/mcp/servers/:id/tools` - List tools
- `POST /api/v1/mcp/servers/:id/tools/:tool/call` - Call tool

### WebSocket
- `WS /ws?user_id=xxx&session_id=xxx` - Connect

## Development

```bash
# Run tests
make test

# Run linter
make lint

# Format code
make fmt

# Generate protobuf
make proto
```

## License

MIT
