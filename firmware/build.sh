#!/usr/bin/env bash
# Compile all ParkGrid firmware with the official Arduino AVR toolchain, inside
# Docker, so nothing needs installing on the host.  Output: firmware/build/*.hex
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="parkgrid-firmware-builder"
docker build -q -t "$IMAGE" . > /dev/null
docker run --rm -v "$PWD":/work "$IMAGE" bash /work/compile.sh

echo
echo "Done. Restart the lab to load the new firmware:  docker compose restart hardware-lab"
