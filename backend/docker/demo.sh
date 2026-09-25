#!/bin/sh
# Atajo desde la raiz del contenedor: /app/demo.sh [--local] [--tenant …]
set -e
cd /app/tools
exec npm run demo -- "$@"
