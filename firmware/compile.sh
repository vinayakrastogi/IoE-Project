#!/usr/bin/env bash
# Runs INSIDE the builder container (see build.sh). Compiles every sketch for
# the Arduino Uno and drops the flash images in /work/build.
set -euo pipefail
cd /work

FQBN="arduino:avr:uno"
OUT="/work/build"
mkdir -p "$OUT"

compile() {   # compile <sketch dir> <output name> [extra -D flags]
  local sketch="$1" name="$2" flags="${3:-}"
  local tmp
  tmp="$(mktemp -d)"
  arduino-cli compile \
    --fqbn "$FQBN" \
    --warnings default \
    --build-property "build.extra_flags=${flags}" \
    --output-dir "$tmp" \
    "$sketch" 2>&1 | grep -Ev '^(Used library|Used platform|Library .* has been declared)' || true
  # The plain .hex starts at address 0 (no bootloader), which is what the emulator loads.
  cp "$tmp/$(basename "$sketch").ino.hex" "$OUT/$name.hex"
  echo "  -> build/$name.hex  ($(wc -c < "$OUT/$name.hex") bytes of HEX)"
  rm -rf "$tmp"
}

echo "Compiling zone controllers (one binary per zone, selected with -DNODE_ZONE)"
for zone in 0 1 2 3 4; do
  letter="$(printf "\\$(printf '%03o' $((97 + zone)))")"
  compile zone_node "zone_${letter}" "-DNODE_ZONE=${zone}"
done

echo "Compiling gate controller"
compile gate_node gate ""
