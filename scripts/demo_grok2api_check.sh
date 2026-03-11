#!/usr/bin/env bash
set -euo pipefail

# Demo: validate local grok2api OpenAI-compatible endpoints.
# Usage:
#   GROK2API_API_KEY=xxx ./scripts/demo_grok2api_check.sh
#   ./scripts/demo_grok2api_check.sh http://127.0.0.1:8000 xxx

BASE_URL="${1:-${GROK2API_BASE_URL:-http://127.0.0.1:8000}}"
API_KEY="${2:-${GROK2API_API_KEY:-}}"
MODEL="${GROK2API_MODEL:-grok-4.1-fast}"

echo "== Grok2API Demo Check =="
echo "BASE_URL: ${BASE_URL}"
echo "MODEL: ${MODEL}"

if [[ -z "${API_KEY}" ]]; then
  echo "ERROR: missing API key. Set GROK2API_API_KEY or pass as 2nd arg."
  exit 2
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

request() {
  local name="$1"
  local method="$2"
  local url="$3"
  local body_file="$4"

  local out_file="${TMP_DIR}/${name}.out"
  local code_file="${TMP_DIR}/${name}.code"

  if [[ -n "${body_file}" ]]; then
    curl -sS -X "${method}" "${url}" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      --data @"${body_file}" \
      -o "${out_file}" \
      -w "%{http_code}" > "${code_file}"
  else
    curl -sS -X "${method}" "${url}" \
      -H "Authorization: Bearer ${API_KEY}" \
      -o "${out_file}" \
      -w "%{http_code}" > "${code_file}"
  fi

  local code
  code="$(<"${code_file}")"
  echo ""
  echo "-- ${name} --"
  echo "HTTP ${code}"
  head -c 400 "${out_file}" || true
  echo ""

  if [[ "${code}" != "200" ]]; then
    return 1
  fi
  return 0
}

# 1) Models
if ! request "models" "GET" "${BASE_URL}/v1/models" ""; then
  echo "FAIL: /v1/models check failed"
  exit 1
fi

# 2) Chat completion
CHAT_BODY="${TMP_DIR}/chat.json"
cat > "${CHAT_BODY}" <<EOF
{
  "model": "${MODEL}",
  "messages": [{"role":"user","content":"Say hello in Chinese, short."}],
  "stream": false,
  "temperature": 0.2
}
EOF

if ! request "chat_completions" "POST" "${BASE_URL}/v1/chat/completions" "${CHAT_BODY}"; then
  echo "FAIL: /v1/chat/completions check failed"
  exit 1
fi

echo ""
echo "PASS: grok2api demo checks succeeded."
