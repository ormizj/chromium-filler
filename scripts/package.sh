#!/usr/bin/env bash
# Build the extension and produce the two release artifacts, which are NOT the
# same zip:
#
#   chromium-filler-v<version>.zip        GitHub release / "Load unpacked".
#                                         Everything nested under a top-level
#                                         chromium-filler/ folder so it unzips
#                                         into one clean directory.
#
#   chromium-filler-v<version>-store.zip  Chrome Web Store upload. manifest.json
#                                         at the ROOT of the archive — the store
#                                         does not descend into a wrapper folder,
#                                         and rejects the GitHub zip above with
#                                         "Manifest file is missing or
#                                         unreadable". Built with `--mode store` so
#                                         the reviewer reads the code as authored
#                                         (see vite.config.ts).
#
# Both come from a fresh dist/, store build last — so whatever is left in dist/
# afterwards is the readable build, the one to load unpacked while reproducing
# anything a reviewer reports.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="chromium-filler"
VERSION=$(node -p "require('./package.json').version")
OUT="${NAME}-v${VERSION}.zip"
STORE_OUT="${NAME}-v${VERSION}-store.zip"
TMP=".pkgtmp"

rm -f "${OUT}" "${STORE_OUT}"
rm -rf "${TMP}"

echo "Building ${NAME} v${VERSION} (minified)..."
npm run build

echo "Packaging ${OUT} (GitHub / load-unpacked)..."
mkdir -p "${TMP}/${NAME}"
cp -R dist/. "${TMP}/${NAME}/"
( cd "${TMP}" && zip -r -X "../${OUT}" "${NAME}" -x '.*' '**/.*' >/dev/null )
rm -rf "${TMP}"

echo "Building ${NAME} v${VERSION} (unminified, for review)..."
npm run build:store

echo "Packaging ${STORE_OUT} (Chrome Web Store upload)..."
( cd dist && zip -r -X "../${STORE_OUT}" . -x '.*' '**/.*' >/dev/null )

# The one mistake this script exists to prevent, asserted rather than assumed:
# the store archive must carry manifest.json at its root.
if ! unzip -l "${STORE_OUT}" | grep -qE ' manifest\.json$'; then
  echo "FAILED: ${STORE_OUT} has no manifest.json at the archive root." >&2
  exit 1
fi

echo "Done."
ls -lh "${OUT}" "${STORE_OUT}"
