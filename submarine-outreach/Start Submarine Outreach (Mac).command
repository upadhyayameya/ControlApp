#!/bin/bash
# Double-click to start the Submarine Outreach portal on a Mac. Keep this window open while you use it.
cd "$(dirname "$0")" || exit 1
PORT_NUM="${PORT:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed yet."
  echo "Opening nodejs.org — download the LTS version, install it, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close this window..." _
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"; then
  echo "Your Node.js ($(node -v)) is too old. Please install the current LTS version from nodejs.org."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close this window..." _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First start: installing (takes about a minute)..."
  npm install --omit=dev --no-audit --no-fund || { read -r -p "Install failed — check your internet connection. Press Enter to close..." _; exit 1; }
fi

if curl -s -o /dev/null "http://localhost:${PORT_NUM}/api/me"; then
  echo "The portal is already running — opening it."
  open "http://localhost:${PORT_NUM}"
  exit 0
fi
(sleep 3; open "http://localhost:${PORT_NUM}") &
echo ""
echo "  Submarine Outreach is running at http://localhost:${PORT_NUM}"
echo "  Keep this window open while you work. Close it (or press Ctrl+C) to stop."
echo "  Emails are only sent and replies only checked while this is running."
echo ""
npm start
