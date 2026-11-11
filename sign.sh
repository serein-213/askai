#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${WEB_EXT_API_KEY:-}" ]]; then
  read -rsp "AMO API key (JWT issuer): " WEB_EXT_API_KEY
  echo
fi
if [[ -z "${WEB_EXT_API_SECRET:-}" ]]; then
  read -rsp "AMO API secret: " WEB_EXT_API_SECRET
  echo
fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

cd "$here"
npx --yes web-ext@10.8.0 sign \
  --source-dir extension \
  --channel unlisted \
  --artifacts-dir dist
