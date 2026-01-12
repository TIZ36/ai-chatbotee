#!/bin/bash
# Stop MySQL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping MySQL..."
docker compose down

echo "✅ MySQL stopped"
