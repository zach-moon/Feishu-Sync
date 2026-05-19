#!/bin/bash
# FeiSync 同步脚本
# 流程：clone/pull 目标仓库 → 扫描 specs → 同步到飞书
#
# 手动运行：./sync.sh
# 定时任务：0 * * * * /path/to/feishu-sync/sync.sh >> /tmp/feisync.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPOS_DIR="$SCRIPT_DIR/.repos"

# 加载 .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

# 确保工具在 PATH 中
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[feisync] $(date '+%Y-%m-%d %H:%M:%S') 开始同步"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 如果设置了 GIT_REPO_URL，自动 clone/pull 到 .repos/ 目录
# 兼容旧变量名 GITLAB_REPO_URL
REPO_URL="${GIT_REPO_URL:-$GITLAB_REPO_URL}"
if [ -n "$REPO_URL" ]; then
  REPO_NAME=$(basename "$REPO_URL" .git)
  REPO_DIR="$REPOS_DIR/$REPO_NAME"
  BRANCH="${GIT_BRANCH:-${GITLAB_BRANCH:-main}}"

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "[feisync] Cloning: $REPO_URL → $REPO_DIR"
    mkdir -p "$REPOS_DIR"
    git clone --branch "$BRANCH" --single-branch --depth 1 "$REPO_URL" "$REPO_DIR" 2>&1 || {
      echo "[ERROR] git clone failed"
      exit 1
    }
  else
    echo "[feisync] git pull: $REPO_DIR"
    git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH" 2>&1 || true
    git -C "$REPO_DIR" reset --hard "origin/$BRANCH" 2>&1 || true
  fi

  export REPO_ROOT="$REPO_DIR"

elif [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT/.git" ]; then
  echo "[feisync] git pull: $REPO_ROOT"
  git -C "$REPO_ROOT" pull --ff-only --quiet 2>&1 || {
    echo "[WARN] git pull 失败，继续使用当前状态"
  }
else
  echo "[WARN] REPO_ROOT 和 GITLAB_REPO_URL 均未设置"
fi

# 执行同步
cd "$SCRIPT_DIR"
npx tsx src/sync-to-feishu.ts

# 同步完成后自动生成并发送日报（除非传了 --no-report）
if [ "$1" != "--no-report" ]; then
  echo "[feisync] 生成日报..."
  npx tsx src/daily-report.ts
fi

echo "[feisync] $(date '+%Y-%m-%d %H:%M:%S') 同步完成"
