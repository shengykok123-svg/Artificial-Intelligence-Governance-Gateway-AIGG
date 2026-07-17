#!/usr/bin/env bash
# M1  Walks all five backbone flows against REPO_BACKEND=memory. No DB, no Docker. Run after every merge.
#
# Proves the spine end-to-end while M2, M3, M5 and M7 are still mocks:
#   1. allow   2. deny   3. redact (+ SD-1)   4. hold -> approve -> unblock
#   5. shadow AI (auto-register, never held)
#
# Exit 0 and "BACKBONE OK" iff every flow produced the verdict it should.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # repo root

PORT="${SMOKE_PORT:-8931}"
BASE="http://127.0.0.1:${PORT}"
API_KEY="${API_KEY:-dev-key-change-me}"
FAIL=0

export REPO_BACKEND=memory
export API_KEY

pass() { echo "  OK   $1"; }
fail() { echo "  FAIL $1"; FAIL=1; }

echo "== starting API on :${PORT} (REPO_BACKEND=memory) =="
(cd backend && python -m uvicorn app.main:app --port "$PORT" --log-level warning) \
  > /tmp/backbone_smoke_uvicorn.log 2>&1 &
SERVER_PID=$!

cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "$BASE/v1/health"; then break; fi
  sleep 0.2
done

health=$(curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/health")
echo "health: $health"

inspect() {
  # inspect <user_id> <target_host> <prompt_json_escaped>
  curl -s -X POST "$BASE/v1/inspect" \
    -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
    -d "{\"user_id\":\"$1\",\"target_host\":\"$2\",\"prompt\":\"$3\"}"
}

field() { python -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }

echo
echo "== 1. allow =="
r=$(inspect "wei.eng@acme.my" "chatgpt.com" "Turn this into bullet points for the standup.")
echo "  $r"
decision=$(echo "$r" | field decision)
[ "$decision" = "allow" ] && pass "decision=allow" || fail "expected allow, got $decision"
log1=$(echo "$r" | field log_id)
curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/logs?limit=200" \
  | python -c "import json,sys; d=json.load(sys.stdin); import sys as s; s.exit(0 if any(x['log_id']=='$log1' for x in d['items']) else 1)" \
  && pass "visible in GET /v1/logs" || fail "not found in GET /v1/logs"

echo
echo "== 2. deny =="
r=$(inspect "wei.eng@acme.my" "chatgpt.com" "Debug this: OPENAI_API_KEY=sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d")
echo "  $r"
decision=$(echo "$r" | field decision)
[ "$decision" = "deny" ] && pass "decision=deny" || fail "expected deny, got $decision"
reason=$(echo "$r" | field reason)
echo "$reason" | grep -qi SECRET && pass "reason names the class" || fail "reason does not name SECRET: $reason"

echo
echo "== 3. redact (+ SD-1) =="
r=$(inspect "aiman.hr@acme.my" "chatgpt.com" "Summarise this employee grievance from Encik Rahman, IC 880412-08-5561.")
echo "  $r"
decision=$(echo "$r" | field decision)
[ "$decision" = "redact" ] && pass "decision=redact" || fail "expected redact, got $decision"
redacted=$(echo "$r" | field redacted_prompt)
echo "$redacted" | grep -q "880412-08-5561" && fail "SD-1: original leaked into redacted_prompt" || pass "redacted_prompt has no original value"
log3=$(echo "$r" | field log_id)
audit_prompt=$(curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/logs?limit=200" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(next(x['prompt_text'] for x in d['items'] if x['log_id']=='$log3'))")
echo "$audit_prompt" | grep -q "880412-08-5561" && fail "SD-1: original leaked into AuditRecord.prompt_text" || pass "SD-1: audit row holds redacted text only"

echo
echo "== 4. hold -> approve -> unblock =="
r=$(inspect "aiman.hr@acme.my" "chatgpt.com" "Draft a reply to the payroll query. Gaji bulanan RM 8,500 for grade M3.")
echo "  $r"
decision=$(echo "$r" | field decision)
[ "$decision" = "hold" ] && pass "decision=hold" || fail "expected hold, got $decision"
log4=$(echo "$r" | field log_id)
status4=$(curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/inspect/$log4" | field status)
[ "$status4" = "pending" ] && pass "status=pending" || fail "expected pending, got $status4"

curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/logs?status=pending&limit=200" \
  | python -c "import json,sys; d=json.load(sys.stdin); import sys as s; s.exit(0 if any(x['log_id']=='$log4' for x in d['items']) else 1)" \
  && pass "shows in GET /v1/logs?status=pending" || fail "missing from pending queue"

curl -s -X POST "$BASE/v1/logs/$log4/decision" \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"approve": true, "remark": "aggregate figures only"}' > /dev/null

status4b=$(curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/inspect/$log4" | field status)
[ "$status4b" = "approved" ] && pass "status=approved after review (unblock)" || fail "expected approved, got $status4b"

echo
echo "== 5. shadow AI =="
r=$(inspect "wei.eng@acme.my" "deepseek.com" "harmless prompt about nothing sensitive")
echo "  $r"
decision=$(echo "$r" | field decision)
[ "$decision" = "allow" ] && pass "not held on account of an unknown host (SD-7)" || fail "expected allow, got $decision"
curl -s -H "X-Api-Key: $API_KEY" "$BASE/v1/tools" \
  | python -c "
import json, sys
tools = json.load(sys.stdin)
row = next((t for t in tools if t['host'] == 'deepseek.com'), None)
sys.exit(1 if row is None else (0 if row['status'] == 'unapproved' and row['tier'] == 'PUBLIC_AI' and row['usage_count'] >= 1 else 1))
" && pass "deepseek.com auto-registered PUBLIC_AI/unapproved, usage_count>=1" || fail "shadow AI not registered correctly"

echo
echo "== errors =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/inspect" \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"user_id":"nobody@acme.my","target_host":"chatgpt.com","prompt":"hi"}')
[ "$code" = "403" ] && pass "unknown user -> 403" || fail "unknown user -> $code (expected 403)"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/inspect" \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"user_id":"wei.eng@acme.my","target_host":"chatgpt.com","prompt":"see attached","attachments":[{"filename":"x.pdf","mime":"application/pdf","content_b64":"AA=="}]}')
[ "$code" = "415" ] && pass "unsupported file -> 415" || fail "unsupported file -> $code (expected 415)"

code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Api-Key: $API_KEY" "$BASE/v1/inspect/does-not-exist")
[ "$code" = "404" ] && pass "unknown log_id -> 404" || fail "unknown log_id -> $code (expected 404)"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "BACKBONE OK"
  exit 0
else
  echo "BACKBONE FAILED -- see FAIL lines above"
  exit 1
fi
