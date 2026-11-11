#!/usr/bin/env bash
set -euo pipefail

restart=1
for arg in "$@"; do
  case "$arg" in
    --no-restart) restart=0 ;;
    -h|--help)
      echo "用法: $0 [--no-restart]"
      echo "  从终端读取 API Key（不回显），写入配置（0600），并启动/重启 systemd 服务。"
      exit 0
      ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

config="${ASKAI_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/askai/config.json}"
[[ -f "$config" ]] || { echo "找不到 $config，先运行 ./install.sh" >&2; exit 1; }

if [[ -t 0 ]]; then
  read -rsp "API Key（输入不回显）: " key
  echo
else
  IFS= read -r key || true
fi
key="${key%$'\r'}"
[[ -n "${key// }" ]] || { echo "key 为空，未修改" >&2; exit 1; }

python3 -c '
import json, os, sys, tempfile
path, key = sys.argv[1], sys.stdin.read().strip()
with open(path, encoding="utf-8") as fh:
    cfg = json.load(fh)
cfg.setdefault("upstream", {})["api_key"] = key
directory = os.path.dirname(os.path.abspath(path))
fd, tmp = tempfile.mkstemp(dir=directory, prefix=".config.")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
print("已写入 " + path)
' "$config" <<< "$key"

if [[ "$restart" -eq 0 ]]; then
  exit 0
fi

unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/askai.service"
if [[ ! -f "$unit" ]]; then
  echo "未安装 systemd 单元（先运行 ./install.sh），key 已保存但未启动服务。" >&2
  exit 0
fi

systemctl --user daemon-reload
systemctl --user reset-failed askai.service 2>/dev/null || true
if systemctl --user is-active --quiet askai.service; then
  systemctl --user restart askai.service
else
  systemctl --user enable --now askai.service
fi
systemctl --user --no-pager --lines=0 status askai.service || true
