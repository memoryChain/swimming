#!/bin/bash
SWIMMING_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$SWIMMING_ROOT" || exit 1
SWIMMING_NODE_BIN="${SWIMMING_NODE:-$(command -v node 2>/dev/null)}"
if [ -z "$SWIMMING_NODE_BIN" ]; then
  for SWIMMING_CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
    if [ -x "$SWIMMING_CANDIDATE" ]; then
      SWIMMING_NODE_BIN="$SWIMMING_CANDIDATE"
      break
    fi
  done
fi
if [ -z "$SWIMMING_NODE_BIN" ]; then
  echo "未找到 Node.js，请安装 Node.js 20 或更新版本后再试。"
  read -r -p "按回车关闭窗口..."
  exit 1
fi
echo "正在上传最近一次 Cocos 微信构建的远程资源，并验证公开下载..."
"$SWIMMING_NODE_BIN" scripts/publish-wechat-cdn.cjs
SWIMMING_RESULT=$?
if [ "$SWIMMING_RESULT" -eq 0 ]; then
  echo "完成：可以回到微信开发者工具上传对应代码包。"
else
  echo "未完成：请查看上方错误；资源发布成功前不要上传新代码包。"
  echo "首次使用或登录过期时，请先执行 pnpm cdn:login。"
fi
read -r -p "按回车关闭窗口..."
exit "$SWIMMING_RESULT"
