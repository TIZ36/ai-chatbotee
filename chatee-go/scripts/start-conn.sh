#!/bin/bash

# Start script for conn_rpc service
# This script will kill existing process and start a new one

SERVICE_NAME="conn_rpc"
BINARY_PATH="./bin/conn_rpc"
PID_FILE="./.pids/conn.pid"
LOG_FILE="./logs/conn.log"
CONFIG_PATH="./configs/config.yaml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Create directories if they don't exist
mkdir -p bin logs .pids

echo -e "${GREEN}Starting ${SERVICE_NAME}...${NC}"

# Check if binary exists
if [ ! -f "$BINARY_PATH" ]; then
    echo -e "${RED}Error: Binary not found at ${BINARY_PATH}${NC}"
    echo -e "${YELLOW}Please run 'make build' first${NC}"
    exit 1
fi

# Kill existing process if running
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

# Start the service
echo -e "${GREEN}Starting ${SERVICE_NAME}...${NC}"
cd "$(dirname "$0")/.." || exit 1
nohup "$BINARY_PATH" > "$LOG_FILE" 2>&1 &
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

