#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${PROJECT_ROOT}/data"
TB_DIR="${PROJECT_ROOT}/tigerbeetle"
DATA_FILE="${DATA_DIR}/0_0.tigerbeetle"
ZIP_PATH="${PROJECT_ROOT}/tigerbeetle.zip"

case "$(uname -s)" in
  Linux)
    TB_URL="https://linux.tigerbeetle.com"
    ;;
  Darwin)
    TB_URL="https://mac.tigerbeetle.com"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

for tool in curl unzip pkill; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${tool}" >&2
    exit 1
  fi
done

mkdir -p "${DATA_DIR}" "${TB_DIR}"

TB_BIN="${TB_DIR}/tigerbeetle"
if [[ ! -f "${TB_BIN}" ]]; then
  echo "Downloading TigerBeetle..."
  curl -Lo "${ZIP_PATH}" "${TB_URL}"
  unzip -o "${ZIP_PATH}" -d "${TB_DIR}"
  rm -f "${ZIP_PATH}"
  chmod +x "${TB_BIN}"
fi

if pgrep -x tigerbeetle >/dev/null 2>&1; then
  echo "Stopping existing TigerBeetle..."
  pkill -x tigerbeetle
  sleep 3
fi

if [[ -f "${DATA_FILE}" ]]; then
  echo "Removing existing data file..."
  rm -f "${DATA_FILE}"
fi

echo "Formatting TigerBeetle data file..."
"${TB_BIN}" format --cluster=1 --replica=0 --replica-count=1 --development "${DATA_FILE}"

echo "Starting TigerBeetle on port 3000..."
exec "${TB_BIN}" start --addresses=3000 --development "${DATA_FILE}"
