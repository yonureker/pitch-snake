#!/bin/sh
# Package the webOS app into an installable .ipk.
#
# It stages an EXPLICIT list of files rather than pointing ares-package at
# webos/ and trying to subtract things. Two reasons, one of them learned here:
# --app-exclude did not actually drop them, so the app shipped its own README
# and a copy of the build directory the .ipk was being written into. And a
# whitelist is the right shape anyway, because the question "what is in the
# app" then has an answer you can read, and a file dropped into webos/ can
# never silently become part of what the television installs.
#
# Adding a file to the app means adding it to APP_FILES. That is deliberate.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)

APP_FILES="appinfo.json index.html icon.png largeicon.png"

if ! command -v ares-package >/dev/null 2>&1; then
  echo "ares-package not found. See webos/README.md:" >&2
  echo "  npm install -g @webos-tools/cli && ares-config --profile tv" >&2
  echo "  (or run 'webOS: Install Global Packages' from VS Code)" >&2
  exit 1
fi

out="$root/webos/build"
stage="$out/app"
rm -rf "$out"
mkdir -p "$stage"

for f in $APP_FILES; do
  if [ ! -f "$root/webos/$f" ]; then
    echo "missing: webos/$f (listed in APP_FILES)" >&2
    exit 1
  fi
  cp "$root/webos/$f" "$stage/$f"
done

ares-package "$stage" --outdir "$out"
rm -rf "$stage"

echo
echo "Built:"
ls -1 "$out"/*.ipk
