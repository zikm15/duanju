#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null; then
  echo 'Cloud preview already responds on port 3000.'
  exit 0
fi
if [ ! -f dist/index.html ]; then bash scripts/install.sh; fi
mkdir -p .runtime
nohup env NODE_ENV=production DEMO_MODE=true PORT=3000 node server/index.js >.runtime/preview.log 2>&1 &
preview_pid=$!
echo "$preview_pid" >.runtime/preview.pid
for attempt in {1..40}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null; then
    echo 'PrimeDrama started in the cloud on port 3000 (internal preview only).'
    exit 0
  fi
  if ! kill -0 "$preview_pid" 2>/dev/null; then cat .runtime/preview.log; exit 1; fi
  sleep 0.25
done
echo 'Preview startup timed out. See .runtime/preview.log.' >&2
exit 1
