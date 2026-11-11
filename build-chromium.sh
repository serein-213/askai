#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

rm -rf build/chromium
mkdir -p build/chromium
cp -a extension/. build/chromium/

python3 - <<'PY'
import json
from pathlib import Path

src = Path("extension/manifest.json")
out = Path("build/chromium/manifest.json")
manifest = json.loads(src.read_text("utf-8"))
manifest.pop("browser_specific_settings", None)
manifest["background"] = {"service_worker": "background.js"}
out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", "utf-8")
PY

VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")

npx --no-install web-ext build \
  --source-dir build/chromium \
  --artifacts-dir dist \
  --overwrite-dest \
  --filename "askai-${VERSION}-chromium.zip"
