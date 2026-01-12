#!/bin/bash

# Stop all services script

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
echo -e "${BLUE}  Chatee Go - Stop All Services${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

PID_DIR="./.pids"
STOPPED=0

# Stop services in reverse order
SERVICES=("http" "conn" "svr" "im" "dbc")

for service in "${SERVICES[@]}"; do
    PID_FILE="$PID_DIR/${service}.pid"
    
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}Stopping $service (PID: $PID)...${NC}"
            kill "$PID" 2>/dev/null || true
            sleep 1
            # Force kill if still running
            if ps -p "$PID" > /dev/null 2>&1; then
                kill -9 "$PID" 2>/dev/null || true
            fi
            echo -e "${GREEN}Stopped $service${NC}"
            STOPPED=$((STOPPED + 1))
        else
            echo -e "${YELLOW}$service was not running${NC}"
        fi
        rm -f "$PID_FILE"
    else
        echo -e "${YELLOW}$service PID file not found${NC}"
    fi
done

# Also kill any remaining processes
echo ""
echo -e "${YELLOW}Cleaning up any remaining processes...${NC}"
pkill -f "bin/dbc_rpc" 2>/dev/null || true
pkill -f "bin/svr_rpc" 2>/dev/null || true
pkill -f "bin/im_rpc" 2>/dev/null || true
pkill -f "bin/conn_rpc" 2>/dev/null || true
pkill -f "bin/chatee_http" 2>/dev/null || true

echo ""
if [ $STOPPED -gt 0 ]; then
    echo -e "${GREEN}Stopped $STOPPED service(s)${NC}"
else
    echo -e "${YELLOW}No services were running${NC}"
fi

