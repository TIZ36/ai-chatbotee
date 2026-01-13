#!/bin/bash

# Start script for dbc_rpc service
# This script will kill existing process and start a new one
# Usage: ./start-dbc.sh [config_file]
# Example: ./start-dbc.sh ./configs/config.yaml

SERVICE_NAME="dbc_rpc"
BINARY_PATH="./bin/dbc_rpc"
PID_FILE="./.pids/dbc.pid"
LOG_FILE="./logs/dbc.log"

# 配置文件路径：优先使用传入参数，否则使用服务内部配置
if [ -n "$1" ]; then
    CONFIG_PATH="$1"
else
    CONFIG_PATH="./services/dbc_rpc/config/config.yaml"
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Create directories if they don't exist
mkdir -p bin logs .pids

echo -e "${GREEN}Starting ${SERVICE_NAME}...${NC}"
echo -e "${YELLOW}Using config: ${CONFIG_PATH}${NC}"

# Step 1: Build
echo -e "${YELLOW}Step 1: Building ${SERVICE_NAME}...${NC}"
go build -o "$BINARY_PATH" ./services/dbc_rpc || {
    echo -e "${RED}Build failed!${NC}"
    exit 1
}
echo -e "${GREEN}✓ Build completed${NC}"

# Step 2: Stop old process
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}Killing existing process (PID: $OLD_PID)...${NC}"
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
        # Force kill if still running
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            kill -9 "$OLD_PID" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# Also kill any process with the same name
pkill -f "$BINARY_PATH" 2>/dev/null || true
sleep 1
echo -e "${GREEN}✓ Old process stopped${NC}"

# Step 3: Start new service
echo -e "${YELLOW}Step 3: Starting new ${SERVICE_NAME}...${NC}"
cd "$(dirname "$0")/.." || exit 1
nohup "$BINARY_PATH" -config "$CONFIG_PATH" > "$LOG_FILE" 2>&1 &
NEW_PID=$!

# Save PID
echo "$NEW_PID" > "$PID_FILE"

# Wait a moment and check if process is still running
sleep 2
if ps -p "$NEW_PID" > /dev/null 2>&1; then
    echo -e "${GREEN}${SERVICE_NAME} started successfully (PID: $NEW_PID)${NC}"
    echo -e "  Log file: ${LOG_FILE}"
    echo -e "  PID file: ${PID_FILE}"
    exit 0
else
    echo -e "${RED}${SERVICE_NAME} failed to start${NC}"
    echo -e "  Check log file: ${LOG_FILE}"
    rm -f "$PID_FILE"
    exit 1
fi

