#!/bin/bash
# Stop Redis

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping Redis..."
docker compose down

echo "✅ Redis stopped"
