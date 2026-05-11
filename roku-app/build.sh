#!/usr/bin/env bash
# Build a sideloadable Roku channel ZIP.
#
# Usage:
#   ./build.sh <backend-lan-ip>                       # build ZIP only
#   ./build.sh <backend-lan-ip> <roku-ip> <password>  # build + sideload
#
# Example:
#   ./build.sh 192.168.1.221                          # outputs ../kidstube-roku.zip
#   ./build.sh 192.168.1.221 192.168.1.37 kidstube123 # builds and sideloads
#
# The backend LAN IP is the host running `docker compose up` on port 3001 —
# the Roku must be on the same network and able to reach this address.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <backend-lan-ip> [<roku-ip> <roku-password>]" >&2
  exit 64
fi

BACKEND_IP="$1"
ROKU_IP="${2:-}"
ROKU_PASSWORD="${3:-}"

if ! [[ "$BACKEND_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: backend ip '$BACKEND_IP' is not a valid IPv4 address" >&2
  exit 64
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Stage a clean copy so we never mutate tracked source files
cp -R "$ROOT/manifest" "$ROOT/source" "$ROOT/components" "$ROOT/images" "$STAGE/"

# Substitute the LAN_IP placeholder in main.brs
sed -i "s|http://LAN_IP:3001|http://${BACKEND_IP}:3001|g" "$STAGE/source/main.brs"

# Verify the substitution actually happened — guard against a future rename of the placeholder
if grep -q "LAN_IP" "$STAGE/source/main.brs"; then
  echo "error: 'LAN_IP' still present in main.brs after substitution" >&2
  exit 1
fi

OUT="$ROOT/../kidstube-roku.zip"
rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" . -x "*.DS_Store" )

# Sanity check: manifest must be at ZIP root, not nested
if ! unzip -l "$OUT" | awk 'NR>3 {print $NF}' | grep -qx "manifest"; then
  echo "error: 'manifest' is not at the ZIP root" >&2
  exit 1
fi

echo "built: $OUT (backend=http://${BACKEND_IP}:3001)"

if [[ -n "$ROKU_IP" ]]; then
  if [[ -z "$ROKU_PASSWORD" ]]; then
    echo "error: roku password required when roku ip is given" >&2
    exit 64
  fi
  echo "sideloading to ${ROKU_IP}..."
  curl -s -S -F "mysubmit=Install" -F "archive=@${OUT}" \
    --digest -u "rokudev:${ROKU_PASSWORD}" \
    "http://${ROKU_IP}/plugin_install" >/dev/null
  echo "sideload complete"
else
  echo
  echo "to sideload (after enabling Roku dev mode):"
  echo "  curl -s -S -F 'mysubmit=Install' -F 'archive=@${OUT}' \\"
  echo "    --digest -u 'rokudev:<password>' \\"
  echo "    'http://<roku-ip>/plugin_install'"
fi
