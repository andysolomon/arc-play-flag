#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the Flag Football Play Designer.
# Runs after the repository is checked out; safe to run repeatedly.
set -euo pipefail

cd "$(dirname "$0")/.."

BUN_VERSION="1.4.0"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Install the pinned Bun toolchain (the project's packageManager) if it is missing
# or on a different version. The installer also records the PATH export in ~/.bashrc,
# so interactive/login shells (and the `terminals` dev server) pick Bun up too.
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version)" != "$BUN_VERSION" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi

bun --version

# Project dependencies (exact lockfile, no drift).
bun install --frozen-lockfile

# Chromium plus its system libraries for the Playwright browser journeys (bun run test:e2e).
bunx playwright install --with-deps chromium

echo "Cloud Agent environment ready."
