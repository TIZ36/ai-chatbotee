#!/bin/bash

# Start script for chatee_http service
# This script will kill existing process and start a new one

SERVICE_NAME="chatee_http"
BINARY_PATH="./bin/chatee_http"
PID_FILE="./.pids/http.pid"
LOG_FILE="./logs/http.log"
CONFIG_PATH="./configs/config.yaml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Create directories if they don't exist
mkdir -p bin logs .pids

echo -e "${GREEN}Starting ${SERVICE_NAME}...${NC}"

# Step 1: Build
echo -e "${YELLOW}Step 1: Building ${SERVICE_NAME}...${NC}"
go build -o "$BINARY_PATH" ./services/chatee_http || {
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

