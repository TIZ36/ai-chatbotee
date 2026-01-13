#!/bin/bash

# HBase Namespace Creation Script
# This script reads HBase configuration from dbc_rpc/config/config.yaml
# and creates the namespace in the local Docker HBase instance

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../../config/config.yaml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}📝 Creating HBase namespace from config...${NC}"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Error: Config file not found at $CONFIG_FILE${NC}"
    exit 1
fi

# Auto-install yq if not available
if ! command -v yq &> /dev/null; then
    echo -e "${YELLOW}yq not found. Installing...${NC}"
    
    # Detect OS and install yq
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - use Homebrew
        if command -v brew &> /dev/null; then
            brew install yq
        else
            echo -e "${RED}Homebrew not found. Cannot auto-install yq.${NC}"
            echo -e "${YELLOW}Using default values instead.${NC}"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux - download binary
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

# Check if namespace exists
echo -e "${YELLOW}Checking if namespace '${NAMESPACE}' exists...${NC}"
NAMESPACE_EXISTS=$(echo "list_namespace" | docker exec -i "$CONTAINER_NAME" /hbase-2.1.3/bin/hbase shell 2>&1 | grep -c "^${NAMESPACE}$" || true)

if [ "$NAMESPACE_EXISTS" -gt 0 ]; then
    echo -e "${GREEN}ℹ️  Namespace '${NAMESPACE}' already exists${NC}"
else
    echo -e "${YELLOW}Creating namespace '${NAMESPACE}'...${NC}"
    echo "create_namespace '${NAMESPACE}'" | docker exec -i "$CONTAINER_NAME" /hbase-2.1.3/bin/hbase shell 2>&1 | grep -v "WARN\|stty" || true
    echo -e "${GREEN}✅ Namespace '${NAMESPACE}' created successfully${NC}"
fi

echo ""
echo -e "${YELLOW}Current namespaces:${NC}"
echo "list_namespace" | docker exec -i "$CONTAINER_NAME" /hbase-2.1.3/bin/hbase shell 2>&1 | grep -E "^[a-z]|row\(s\)"

echo ""
echo -e "${GREEN}✅ HBase namespace setup completed!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Create tables in namespace '${NAMESPACE}'"
echo -e "  2. Run: ./create_tables.sh"
