#!/bin/sh
# Package webos/ into an installable .ipk.
#
# Thin on purpose: ares-package IS the build, and everything it needs is
# already sitting in webos/. This script exists so the output path is the same
# every time and so webos/build never lands in a commit.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)

if ! command -v ares-package >/dev/null 2>&1; then
  echo "ares-package not found. See webos/README.md:" >&2
  echo "  npm install -g @webos-tools/cli && ares-config --profile tv" >&2
  exit 1
fi

rm -rf "$root/webos/build"
mkdir -p "$root/webos/build"
ares-package "$root/webos" --outdir "$root/webos/build"
echo
echo "Built:"
ls -1 "$root/webos/build"/*.ipk
