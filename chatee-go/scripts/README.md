# Service Management Scripts

This directory contains scripts for managing Chatee Go services.

## Scripts Overview

### Individual Service Scripts

- **start-dbc.sh** - Start the DBC (Data Base Connection) RPC service
- **start-svr.sh** - Start the SVR (Service) RPC service
- **start-im.sh** - Start the IM (Instant Message) RPC service
- **start-conn.sh** - Start the CONN (Connection/WebSocket) RPC service
- **start-http.sh** - Start the HTTP API service

### Management Scripts

- **start-all.sh** - Start all services in the correct order
- **stop-all.sh** - Stop all running services
- **status.sh** - Check the status of all services

## Features

- **Auto-restart**: Each script will automatically kill existing processes before starting a new one
- **Process management**: All scripts use PID files to track running processes
- **Logging**: All service output is redirected to `./logs/<service>.log`
- **Error handling**: Scripts check for binary existence and process status

## Usage

### Start All Services

```bash
# From project root
./scripts/start-all.sh
```

This will:
1. Check if binaries exist (build if missing)
2. Start services in order: DBC → IM → SVR → CONN → HTTP
3. Wait between services to ensure dependencies are ready
4. Show a summary of started services

### Start Individual Service

```bash
# Start a specific service
./scripts/start-conn.sh
./scripts/start-http.sh
# etc.
```

Each script will:
- Kill any existing process with the same name
- Start a new process in the background
- Save the PID to `./.pids/<service>.pid`
- Redirect output to `./logs/<service>.log`

### Check Service Status

```bash
./scripts/status.sh
```

Shows:
- Running services with their PIDs
- Stopped services
- Port status (which ports are in use)

### Stop All Services

```bash
./scripts/stop-all.sh
```

This will:
1. Stop services in reverse order: HTTP → CONN → SVR → IM → DBC
2. Clean up any remaining processes
3. Remove PID files

## Service Dependencies

Services must be started in this order:

1. **DBC** (Data Base Connection) - No dependencies
2. **IM** (Instant Message) - Depends on DBC
3. **SVR** (Service) - Depends on DBC
4. **CONN** (Connection/WebSocket) - Depends on SVR and IM
5. **HTTP** (HTTP API) - Depends on all services

## Service Endpoints

Once all services are running:

- **DBC RPC**: gRPC `:9091`
- **IM RPC**: gRPC `:9093`
- **SVR RPC**: gRPC `:9092`
- **CONN RPC**: WebSocket `:8081`
- **HTTP API**: HTTP `:8080`

## Logs

All service logs are written to:
- `./logs/dbc.log`
- `./logs/im.log`
- `./logs/svr.log`
- `./logs/conn.log`
- `./logs/http.log`

View logs:
```bash
# View all logs
tail -f logs/*.log

# View specific service log
tail -f logs/conn.log
```

## PID Files

PID files are stored in `./.pids/`:
- `./.pids/dbc.pid`
- `./.pids/im.pid`
- `./.pids/svr.pid`
- `./.pids/conn.pid`
- `./.pids/http.pid`

## Troubleshooting

### Service won't start

1. Check if the binary exists:
   ```bash
   ls -lh bin/
   ```

2. Build missing services:
   ```bash
   make build
   ```

3. Check logs:
   ```bash
   tail -f logs/<service>.log
   ```

### Service keeps restarting

1. Check if there are multiple processes:
   ```bash
   ps aux | grep <service>
   ```

2. Kill all processes manually:
   ```bash
   pkill -f <service>
   ```

3. Remove stale PID files:
   ```bash
   rm -f .pids/<service>.pid
   ```

### Port already in use

1. Check which process is using the port:
   ```bash
   lsof -i :<port>
   ```

2. Kill the process or change the port in `configs/config.yaml`

## Examples

### Development Workflow

```bash
# 1. Build all services
make build

# 2. Start all services
./scripts/start-all.sh

# 3. Check status
./scripts/status.sh

# 4. View logs
tail -f logs/*.log

# 5. Stop all services when done
./scripts/stop-all.sh
```

### Restart a Single Service

```bash
# Restart conn_rpc (will kill old process first)
./scripts/start-conn.sh
```

### Quick Status Check

```bash
./scripts/status.sh
```

