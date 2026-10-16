#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if(Number(process.versions.node.split(".")[0])<24)throw new Error("Node.js 24 or newer is required")'
command -v ffprobe >/dev/null
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
if [ ! -f media/after-hours.mp4 ]; then
  command -v ffmpeg >/dev/null
  npm run media
fi
npm run build
