#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/askai"
config="$config_dir/config.json"

mkdir -p "$config_dir"
chmod 700 "$config_dir"

if [[ -f "$config" ]]; then
  echo "配置已存在：$config"
else
  install -m 600 "$here/proxy/config.example.json" "$config"
  chmod 600 "$config"
  echo "已生成配置：$config"
fi

echo
echo "下一步："
echo "  1. 编辑 $config，填入 upstream.api_key"
echo "     （或改用环境变量 ASKAI_API_KEY，文件里就不需要写 key）"
echo "  2. 启动代理：python3 $here/proxy/server.py"
echo "  3. Firefox 打开 about:debugging#/runtime/this-firefox"
echo "     → 临时载入扩展 → 选择 $here/extension/manifest.json"
echo
echo "配置权限：$(stat -c '%a' "$config")"
