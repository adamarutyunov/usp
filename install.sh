#!/bin/sh
set -e

REPO_URL="${USP_REPO_URL:-https://github.com/adamarutyunov/usp.git}"
REF="${VERSION:-main}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed"
    exit 1
  fi
}

require_cmd git
require_cmd node
require_cmd npm

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Installing Ultimate Social Poster from ${REPO_URL} (${REF})..."

git clone --depth 1 --branch "$REF" "$REPO_URL" "$TMP/usp" >/dev/null 2>&1 || {
  echo "Could not clone ref '${REF}', trying default branch..."
  git clone --depth 1 "$REPO_URL" "$TMP/usp" >/dev/null
}

cd "$TMP/usp"

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build
npm install -g .

echo "Installing Playwright Chromium..."
npx playwright install chromium

echo "Done."
echo "Run: usp setup"
echo "Then: usp login x"
