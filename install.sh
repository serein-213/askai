#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/askai"
config="$config_dir/config.json"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$unit_dir/askai.service"

force=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    -h|--help)
      echo "用法: $0 [--force]"
      echo "  --force  重新生成 systemd 单元"
      exit 0
      ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

python_bin="$(command -v python3 || true)"
[[ -n "$python_bin" ]] || { echo "找不到 python3" >&2; exit 1; }

mkdir -p "$config_dir"
chmod 700 "$config_dir"

if [[ -f "$config" ]]; then
  echo "配置已存在：$config"
else
  install -m 600 "$here/proxy/config.example.json" "$config"
  echo "已生成配置：$config"
fi
chmod 600 "$config"

mkdir -p "$unit_dir"
if [[ -f "$unit" && "$force" -eq 0 ]]; then
  echo "systemd 单元已存在：$unit（更新用 ./install.sh --force）"
else
  cat > "$unit" <<EOF
[Unit]
Description=AskAI local proxy (127.0.0.1:8787)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=$python_bin "$here/proxy/server.py"
Environment="ASKAI_CONFIG=$config"
Environment=PYTHONDONTWRITEBYTECODE=1
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths="$config_dir"

[Install]
WantedBy=default.target
EOF
  echo "已安装 systemd 用户单元：$unit"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
fi

echo
echo "下一步："
echo "  ./set-key.sh      # 输入 API Key（不回显），写入 0600 并启动服务"
echo
echo "  扩展：Firefox 打开 about:debugging#/runtime/this-firefox"
echo "        → 临时载入 → $here/extension/manifest.json"
echo
echo "配置权限：$(stat -c '%a' "$config")"
