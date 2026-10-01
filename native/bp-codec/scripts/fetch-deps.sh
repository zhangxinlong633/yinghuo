#!/usr/bin/env bash
# Clone QCBOR v1.5.1 and bplib main into native/third_party when missing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TP="${ROOT}/native/third_party"
QCBOR_DIR="${TP}/QCBOR"
BPLIB_DIR="${TP}/bplib"
COMMIT_FILE="${ROOT}/native/bp-codec/BPLIB_COMMIT.txt"

# git does not read the macOS system proxy. Use it when no proxy is already set.
if [[ -z "${https_proxy:-}${HTTPS_PROXY:-}" ]] && command -v scutil >/dev/null 2>&1; then
  proxy_line="$(scutil --proxy 2>/dev/null | awk '
    $1 == "HTTPSEnable" && $3 == "1" { enabled=1 }
    $1 == "HTTPSProxy" { host=$3 }
    $1 == "HTTPSPort" { port=$3 }
    END { if (enabled && host && port) printf "http://%s:%s\n", host, port }
  ')"
  if [[ -n "${proxy_line}" ]]; then
    export http_proxy="${proxy_line}" https_proxy="${proxy_line}"
  fi
fi

mkdir -p "${TP}"

if [[ ! -d "${QCBOR_DIR}/.git" ]]; then
  git clone --depth 1 --branch v1.5.1 https://github.com/laurencelundblade/QCBOR.git "${QCBOR_DIR}"
fi

if [[ ! -d "${BPLIB_DIR}/.git" ]]; then
  git clone --depth 1 --branch main https://github.com/nasa/bplib.git "${BPLIB_DIR}"
fi

git -C "${BPLIB_DIR}" rev-parse HEAD > "${COMMIT_FILE}"
echo "QCBOR: ${QCBOR_DIR}"
echo "bplib: ${BPLIB_DIR} @ $(cat "${COMMIT_FILE}")"
