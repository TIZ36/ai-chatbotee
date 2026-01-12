#!/bin/bash
# Stop HBase

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping HBase..."
docker compose down

echo "✅ HBase stopped"
