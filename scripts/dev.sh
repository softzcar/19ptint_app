#!/usr/bin/env bash
# Levanta todo el stack para desarrollo local: mysql/redis (brew services),
# backend, worker, ai-service y frontend, cada uno con su log prefijado.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> Verificando mysql/redis (brew services)..."
brew services start mysql >/dev/null 2>&1 || true
brew services start redis >/dev/null 2>&1 || true

PIDS=()
cleanup() {
  echo ""
  echo "==> Deteniendo procesos..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

run() {
  local nombre="$1"; shift
  ( "$@" 2>&1 | sed -u "s/^/[$nombre] /" ) &
  PIDS+=($!)
}

run "backend" bash -c "cd '$ROOT/packages/backend' && npm run start"
run "worker" bash -c "cd '$ROOT/packages/worker' && npm run start"
run "ai-service" bash -c "cd '$ROOT/packages/ai-service' && source venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8000"
run "frontend" bash -c "cd '$ROOT/packages/frontend' && npm run dev"

echo "==> Todo arriba. Frontend: http://localhost:5173  Backend: http://localhost:4000  AI: http://localhost:8000"
echo "==> Ctrl+C para detener todo."
wait
