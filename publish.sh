#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

version="$(python3 -c 'import json;print(json.load(open("extension/manifest.json"))["version"])')"
asset="dist/askai-$version.xpi"

"$here/sign.sh"

python3 - "$asset" <<'PY'
import glob, os, shutil, sys, zipfile
asset = sys.argv[1]
signed = [
    p
    for p in glob.glob("dist/*.xpi")
    if any(n.startswith("META-INF/") for n in zipfile.ZipFile(p).namelist())
]
if not signed:
    raise SystemExit("错误：dist/ 里没有已签名的 XPI")
if os.path.abspath(signed[0]) != os.path.abspath(asset):
    shutil.copyfile(signed[0], asset)
print("release asset:", asset)
PY

tag="v$version"
if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" "$asset" --clobber
else
  gh release create "$tag" "$asset" \
    --title "AskAI 划词 $tag" \
    --notes-file "$here/RELEASE_NOTES.md"
fi
gh release view "$tag" --json url,assets
