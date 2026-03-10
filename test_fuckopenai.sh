#!/usr/bin/env bash
set -euo pipefail
if [ "${FUCKOPENAI_API_KEY:-}" = "" ]; then
  echo "请先设置环境变量 API_KEY，例如："
  echo "  API_KEY=sk-xxxx ./test_fuckopenai.sh"
  exit 1
fi
URL="https://fuckopenai.net/api/v1/responses"
echo "请求 URL: $URL"
echo
# 非流式测试，方便看状态码
HTTP_STATUS=$(curl -sS -o /tmp/fuckopenai_resp.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FUCKOPENAI_API_KEY" \
  -X POST "$URL" \
  -d '{
    "model": "gpt-5.4",
    "input": [{"role": "user", "content": "Hello"}],
    "stream": false,
    "store": false
  }')
echo "HTTP 状态码: $HTTP_STATUS"
echo
echo "响应 body:"
cat /tmp/fuckopenai_resp.json
echo
