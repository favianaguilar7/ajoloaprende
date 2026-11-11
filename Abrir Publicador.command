#!/bin/zsh
# Doble clic para abrir el panel. Deja esta ventana abierta mientras lo usas.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
if curl -s -o /dev/null http://localhost:3939/api/config; then
  echo "El panel ya estaba abierto."
  open http://localhost:3939
  exit 0
fi
( sleep 1.5; open http://localhost:3939 ) &
echo "Panel en http://localhost:3939 — cierra esta ventana (o Ctrl+C) para apagarlo."
exec node server.mjs
