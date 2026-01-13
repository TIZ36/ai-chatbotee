#!/bin/bash

# HBase Tables Creation Script
# This script creates all required HBase tables in the configured namespace

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../../config/config.yaml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}📝 Creating HBase tables from config...${NC}"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Error: Config file not found at $CONFIG_FILE${NC}"
    exit 1
fi

# Auto-install yq if not available
if ! command -v yq &> /dev/null; then
    echo -e "${YELLOW}yq not found. Installing...${NC}"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            brew install yq
        else
            echo -e "${RED}Homebrew not found. Cannot auto-install yq.${NC}"
            echo -e "${YELLOW}Using default values instead.${NC}"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        YQ_VERSION="v4.35.1"
        YQ_BINARY="yq_linux_amd64"
        wget "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY}" -O /tmp/yq
        chmod +x /tmp/yq
        sudo mv /tmp/yq /usr/local/bin/yq
        echo -e "${GREEN}yq installed successfully${NC}"
    fi
fi

# Extract HBase configuration
if ! command -v yq &> /dev/null; then
    echo -e "${YELLOW}Warning: yq not available. Using default values.${NC}"
    NAMESPACE="chatee"
else
    NAMESPACE=$(yq eval '.hbase.namespace' "$CONFIG_FILE")
fi

echo -e "${YELLOW}Config:${NC}"
echo -e "  Namespace: ${GREEN}${NAMESPACE}${NC}"
echo ""

# Find HBase container
CONTAINER_NAME=$(docker ps --filter "name=hbase" --format "{{.Names}}" | head -n 1)

if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}Error: HBase container not found. Please start HBase first.${NC}"
    exit 1
fi

echo -e "${GREEN}Found HBase container: ${CONTAINER_NAME}${NC}"
echo ""

echo -e "${YELLOW}Creating tables in namespace '${NAMESPACE}'...${NC}"

# Get existing tables
EXISTING_TABLES=$(echo "list_namespace_tables '${NAMESPACE}'" | docker exec -i "$CONTAINER_NAME" /hbase-2.1.3/bin/hbase shell 2>&1 | grep -E "^${NAMESPACE}:" | sed "s/${NAMESPACE}://g" || true)

# Helper function to create table if not exists
create_table_if_not_exists() {
    local TABLE_NAME=$1
    local COLUMN_FAMILY=$2
    local FULL_TABLE="${NAMESPACE}:${TABLE_NAME}"
    
    if echo "$EXISTING_TABLES" | grep -q "^${TABLE_NAME}$"; then
        echo -e "${GREEN}ℹ️  ${FULL_TABLE} already exists${NC}"
    else
        echo -e "${YELLOW}Creating ${FULL_TABLE}...${NC}"
        echo "create '${FULL_TABLE}', '${COLUMN_FAMILY}'" | docker exec -i "$CONTAINER_NAME" /hbase-2.1.3/bin/hbase shell 2>&1 | grep -v "WARN\|stty" || true
        echo -e "${GREEN}✅ ${FULL_TABLE} created${NC}"
    fi
}

# Create all tables
create_table_if_not_exists "chatee_threads_metadata" "meta"
create_table_if_not_exists "chatee_threads_messages" "msg"
create_table_if_not_exists "chatee_follow_feed" "feed"
create_table_if_not_exists "chatee_reply_feed" "feed"
create_table_if_not_exists "chatee_chats_metadata" "meta"
create_table_if_not_exists "chatee_chats_inbox" "inbox"

echo ""
echo -e "${YELLOW}Current tables in namespace '${NAMESPACE}':${NC}"
echo "list_namespace_tables '${NAMESPACE}'" | docker exec -i "$CONTAINER_NAME" /hbase-2.1.3/bin/hbase shell 2>&1 | grep -E "^${NAMESPACE}:|row\(s\)"

echo ""
echo -e "${GREEN}✅ HBase tables setup completed!${NC}"
echo -e "${YELLOW}Tables:${NC}"
echo -e "  - ${NAMESPACE}:chatee_threads_metadata (meta)"
echo -e "  - ${NAMESPACE}:chatee_threads_messages (msg)"
echo -e "  - ${NAMESPACE}:chatee_follow_feed (feed)"
echo -e "  - ${NAMESPACE}:chatee_reply_feed (feed)"
echo -e "  - ${NAMESPACE}:chatee_chats_metadata (meta)"
echo -e "  - ${NAMESPACE}:chatee_chats_inbox (inbox)"
