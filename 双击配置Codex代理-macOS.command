#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "正在为 Codex 启用系统代理支持..."
echo

NODE_BIN="$(command -v node 2>/dev/null)"
if [ -z "$NODE_BIN" ]; then
  for CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$CANDIDATE" ]; then
      NODE_BIN="$CANDIDATE"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "[失败] 没有找到 Node.js。"
  echo "请先安装 Node.js，或安装已包含 Node.js 的项目开发环境，然后重新双击此文件。"
  echo
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

"$NODE_BIN" "scripts/setup-codex-system-proxy.mjs"
SETUP_EXIT_CODE=$?

echo
if [ "$SETUP_EXIT_CODE" -eq 0 ]; then
  echo "[成功] 配置已经完成。请完整退出并重新打开 Codex。"
else
  echo "[失败] 配置没有完成，请把此窗口中的内容发给项目维护者。"
fi
echo
read -r -p "按回车键关闭窗口..."
exit "$SETUP_EXIT_CODE"
