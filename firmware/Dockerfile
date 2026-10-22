# Reproducible Arduino toolchain for the ParkGrid firmware (avr-gcc 7.3 via the
# official arduino:avr core). Build the images once, then `./build.sh` compiles
# every sketch into firmware/build/*.hex -- the exact bytes the hardware lab
# emulator (and a real Arduino Uno) would run.
FROM debian:bookworm-slim

ARG ARDUINO_CLI_VERSION=1.5.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      arm64) ARCH=ARM64 ;; \
      amd64) ARCH=64bit ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://downloads.arduino.cc/arduino-cli/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_${ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin arduino-cli

ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/downloads

RUN arduino-cli core update-index \
 && arduino-cli core install arduino:avr@1.8.6 \
 && arduino-cli lib install Servo LiquidCrystal \
 && arduino-cli lib list

WORKDIR /work
