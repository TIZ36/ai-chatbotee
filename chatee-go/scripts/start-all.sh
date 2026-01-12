#!/bin/bash

# Start all services script
# This script will start all services in the correct order
# If services are already running, it will kill and restart them

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT" || exit 1

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Chatee Go - Start All Services${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Create necessary directories
mkdir -p bin logs .pids

# Check if binaries exist
MISSING_BINARIES=()
[ ! -f "./bin/dbc_rpc" ] && MISSING_BINARIES+=("dbc_rpc")
[ ! -f "./bin/svr_rpc" ] && MISSING_BINARIES+=("svr_rpc")
[ ! -f "./bin/im_rpc" ] && MISSING_BINARIES+=("im_rpc")
[ ! -f "./bin/conn_rpc" ] && MISSING_BINARIES+=("conn_rpc")
[ ! -f "./bin/chatee_http" ] && MISSING_BINARIES+=("chatee_http")

if [ ${#MISSING_BINARIES[@]} -gt 0 ]; then
    echo -e "${YELLOW}Warning: Some binaries are missing:${NC}"
    for bin in "${MISSING_BINARIES[@]}"; do
        echo -e "  - ${bin}"
    done
    echo ""
    echo -e "${YELLOW}Attempting to build missing services...${NC}"
    make build 2>&1 | grep -E "(Building|Error|failed)" || true
    echo ""
    
    # Re-check after build attempt
    STILL_MISSING=()
    for bin in "${MISSING_BINARIES[@]}"; do
        [ ! -f "./bin/${bin}" ] && STILL_MISSING+=("${bin}")
    done
    
    if [ ${#STILL_MISSING[@]} -gt 0 ]; then
        echo -e "${RED}Error: The following services could not be built:${NC}"
        for bin in "${STILL_MISSING[@]}"; do
            echo -e "  ✗ ${bin}"
        done
        echo ""
        echo -e "${YELLOW}These services have compilation errors and will be skipped.${NC}"
        echo -e "${YELLOW}Check the build output above for details.${NC}"
        echo ""
    fi
fi

# Service start order and dependencies
# 1. DBC (Data Base Connection) - No dependencies
# 2. IM (Instant Message) - Depends on DBC
# 3. SVR (Service) - Depends on DBC
# 4. CONN (Connection/WebSocket) - Depends on SVR and IM
# 5. HTTP (HTTP API) - Depends on all services

SERVICES=(
    "dbc:./scripts/start-dbc.sh:Data access layer (gRPC :9091)"
    "im:./scripts/start-im.sh:Instant messaging (gRPC :9093)"
    "svr:./scripts/start-svr.sh:Service layer (gRPC :9092)"
    "conn:./scripts/start-conn.sh:WebSocket server (WS :8081)"
    "http:./scripts/start-http.sh:HTTP API (HTTP :8080)"
)

FAILED_SERVICES=()
SUCCESS_SERVICES=()
SKIPPED_SERVICES=()

# Start services in order
for service_info in "${SERVICES[@]}"; do
    IFS=':' read -r service_name script_path description <<< "$service_info"
    
    # Check if binary exists
    BINARY_NAME=""
    case "$service_name" in
        dbc) BINARY_NAME="dbc_rpc" ;;
        im) BINARY_NAME="im_rpc" ;;
        svr) BINARY_NAME="svr_rpc" ;;
        conn) BINARY_NAME="conn_rpc" ;;
        http) BINARY_NAME="chatee_http" ;;
    esac
    
    if [ ! -f "./bin/${BINARY_NAME}" ]; then
        echo -e "${YELLOW}[$service_name]${NC} $description"
        echo -e "${YELLOW}  ⚠ Skipped (binary not found)${NC}"
        SKIPPED_SERVICES+=("$service_name")
        echo ""
        continue
    fi
    
    echo -e "${BLUE}----------------------------------------${NC}"
    echo -e "${GREEN}[$service_name]${NC} $description"
    echo -e "${BLUE}----------------------------------------${NC}"
    
    if [ ! -f "$script_path" ]; then
        echo -e "${RED}Error: Script not found: $script_path${NC}"
        FAILED_SERVICES+=("$service_name")
        continue
    fi
    
    # Make script executable
    chmod +x "$script_path"
    
    # Run the start script
    if bash "$script_path"; then
        SUCCESS_SERVICES+=("$service_name")
        # Wait a bit before starting next service
        sleep 2
    else
        FAILED_SERVICES+=("$service_name")
        echo -e "${RED}Failed to start $service_name${NC}"
    fi
    
    echo ""
done

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Startup Summary${NC}"
echo -e "${BLUE}========================================${NC}"

if [ ${#SUCCESS_SERVICES[@]} -gt 0 ]; then
    echo -e "${GREEN}Successfully started services:${NC}"
    for svc in "${SUCCESS_SERVICES[@]}"; do
        echo -e "  ✓ $svc"
    done
    echo ""
fi

if [ ${#SKIPPED_SERVICES[@]} -gt 0 ]; then
    echo -e "${YELLOW}Skipped services (not built):${NC}"
    for svc in "${SKIPPED_SERVICES[@]}"; do
        echo -e "  ⚠ $svc"
    done
    echo ""
fi

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    echo -e "${RED}Failed to start services:${NC}"
    for svc in "${FAILED_SERVICES[@]}"; do
        echo -e "  ✗ $svc"
    done
    echo ""
    echo -e "${YELLOW}Check log files in ./logs/ for details${NC}"
    if [ ${#SUCCESS_SERVICES[@]} -eq 0 ]; then
        exit 1
    fi
fi

if [ ${#SUCCESS_SERVICES[@]} -gt 0 ]; then
    echo -e "${GREEN}Services started!${NC}"
    echo ""
    echo -e "${BLUE}Service Endpoints:${NC}"
    [ -f "./bin/dbc_rpc" ] && echo -e "  - DBC RPC:    gRPC :9091"
    [ -f "./bin/im_rpc" ] && echo -e "  - IM RPC:     gRPC :9093"
    [ -f "./bin/svr_rpc" ] && echo -e "  - SVR RPC:    gRPC :9092"
    [ -f "./bin/conn_rpc" ] && echo -e "  - CONN RPC:   WebSocket :8081"
    [ -f "./bin/chatee_http" ] && echo -e "  - HTTP API:   HTTP :8080"
    echo ""
    echo -e "${BLUE}Useful commands:${NC}"
    echo -e "  - View logs:    tail -f logs/*.log"
    echo -e "  - Check status: ./scripts/status.sh"
    echo -e "  - Stop all:     ./scripts/stop-all.sh"
    echo ""
fi
