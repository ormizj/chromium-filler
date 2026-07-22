#!/usr/bin/env bash
# Build the extension and zip dist/ into a release artifact for GitHub.
# Output: chromium-filler-v<version>.zip, with everything nested under a
# top-level chromium-filler/ folder so it unzips clean for "Load unpacked".
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="chromium-filler"
VERSION=$(node -p "require('./package.json').version")
OUT="${NAME}-v${VERSION}.zip"
TMP=".pkgtmp"

echo "Building ${NAME} v${VERSION}..."
npm run build

echo "Packaging ${OUT}..."
rm -f "${OUT}"
rm -rf "${TMP}"
mkdir -p "${TMP}/${NAME}"
cp -R dist/. "${TMP}/${NAME}/"
( cd "${TMP}" && zip -r -X "../${OUT}" "${NAME}" -x '.*' '**/.*' >/dev/null )
rm -rf "${TMP}"

echo "Done: ${OUT}"
ls -lh "${OUT}"
