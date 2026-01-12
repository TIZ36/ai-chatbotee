#!/bin/bash

# Status check script for all services

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
echo -e "${BLUE}  Chatee Go - Service Status${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

PID_DIR="./.pids"

declare -A SERVICE_INFO=(
    ["dbc"]="DBC RPC:9091"
    ["im"]="IM RPC:9093"
    ["svr"]="SVR RPC:9092"
    ["conn"]="CONN RPC:8081"
    ["http"]="HTTP API:8080"
)

RUNNING=0
STOPPED=0

for service in "${!SERVICE_INFO[@]}"; do
    PID_FILE="$PID_DIR/${service}.pid"
    SERVICE_NAME="${SERVICE_INFO[$service]}"
    
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} $SERVICE_NAME ${GREEN}(Running, PID: $PID)${NC}"
            RUNNING=$((RUNNING + 1))
        else
            echo -e "${RED}✗${NC} $SERVICE_NAME ${RED}(Stopped, stale PID file)${NC}"
            STOPPED=$((STOPPED + 1))
            rm -f "$PID_FILE"
        fi
    else
        echo -e "${YELLOW}○${NC} $SERVICE_NAME ${YELLOW}(Not started)${NC}"
        STOPPED=$((STOPPED + 1))
    fi
done

echo ""
echo -e "${BLUE}Port Status:${NC}"

# Check ports
check_port() {
    local port=$1
    if lsof -i ":$port" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Port $port: ${GREEN}In use${NC}"
    else
        echo -e "  ${YELLOW}○${NC} Port $port: ${YELLOW}Free${NC}"
    fi
}

check_port 9091
check_port 9092
check_port 9093
check_port 8080
check_port 8081

echo ""
if [ $RUNNING -gt 0 ]; then
    echo -e "${GREEN}Running: $RUNNING service(s)${NC}"
fi
if [ $STOPPED -gt 0 ]; then
    echo -e "${YELLOW}Stopped: $STOPPED service(s)${NC}"
fi

