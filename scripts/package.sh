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
# Pass a version to release a new one — `npm run package -- 0.1.2` — and
# scripts/version.mjs checks it is not a downgrade and writes it into every file
# that carries it before anything is built. With no argument the current version
# is packaged as before. Either way it refuses a package.json and a
# manifest.config.ts that disagree.
#
# Both come from a fresh dist/, store build last — so whatever is left in dist/
# afterwards is the readable build, the one to load unpacked while reproducing
# anything a reviewer reports.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="chromium-filler"
# The store's item id, also at the top of design/store/LISTING.md.
ITEM_ID="ibdmodmpbhmemofnmgilhgealaeipkmd"
VERSION=$(node scripts/version.mjs "${1:-}")
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
# the store archive must carry manifest.json at its root. The listing is captured
# first: piped straight into `grep -q`, grep exits on the first match, unzip dies
# of SIGPIPE, and `pipefail` reports a correct archive as a failure.
LISTING=$(unzip -l "${STORE_OUT}")
if ! grep -qE ' manifest\.json$' <<<"${LISTING}"; then
  echo "FAILED: ${STORE_OUT} has no manifest.json at the archive root." >&2
  exit 1
fi

echo "Done."
ls -lh "${OUT}" "${STORE_OUT}"

cat <<EOF2

Upload v${VERSION} to the Chrome Web Store:

  https://chrome.google.com/webstore/devconsole

  1. Open "Chromium Filler" (item ${ITEM_ID}).
  2. Package -> "Upload new package" -> choose ${STORE_OUT}
     (the -store zip; the other one is rejected for its wrapper folder).
  3. Check Store listing / Privacy for anything this version changed
     (paste-ready copy: design/store/LISTING.md).
  4. "Submit for review".

  ${OUT} is the one for a GitHub release or "Load unpacked".
EOF2

# Said again here because the same line before the build has scrolled away by now.
if [[ -z "${1:-}" ]]; then
  NEXT=$(node --input-type=module -e "import { nextPatch } from './scripts/version.mjs'; console.log(nextPatch('${VERSION}'))")
  cat <<EOF3

  This packaged the CURRENT version (v${VERSION}) — the store rejects a version it
  already has. To release a new one, pass it instead, e.g.:

    npm run package -- ${NEXT}
EOF3
fi
