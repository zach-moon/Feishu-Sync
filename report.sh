#!/bin/bash
# FeiSync 日报脚本（独立运行，不触发同步）
# 手动运行：./report.sh
# 定时任务：0 17 * * * /path/to/feishu-sync/report.sh >> /tmp/feisync-report.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 加载 .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

# 确保工具在 PATH 中（兼容 cron 等非交互环境）
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

# 加载 nvm
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi
if [ -d "$NVM_DIR/versions/node" ]; then
  NODE_BIN="$(ls -1 "$NVM_DIR/versions/node" 2>/dev/null | sort -V | tail -1)"
  if [ -n "$NODE_BIN" ] && [ -d "$NVM_DIR/versions/node/$NODE_BIN/bin" ]; then
    export PATH="$NVM_DIR/versions/node/$NODE_BIN/bin:$PATH"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[feisync-report] $(date '+%Y-%m-%d %H:%M:%S') 生成日报"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$SCRIPT_DIR"
npx tsx src/daily-report.ts

echo "[feisync-report] $(date '+%Y-%m-%d %H:%M:%S') 日报完成"
