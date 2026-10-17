#!/bin/sh
set -eu
data_dir="${DATA_DIR:-/var/data/afterglow}"
case "$data_dir" in
  /var/data/afterglow) ;;
  *) echo 'Container DATA_DIR must be /var/data/afterglow; mount persistent storage at /var/data.' >&2; exit 1 ;;
esac
mkdir -p "$data_dir"
if [ "$(id -u)" = 0 ]; then
  chown -R node:node "$data_dir"
  exec gosu node node server/index.js
fi
exec node server/index.js
