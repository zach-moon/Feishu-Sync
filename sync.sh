#!/usr/bin/env bash
# FeiSync 同步脚本
# 流程：clone/pull 目标仓库 → 扫描 specs → 同步到飞书
#
# 手动运行：./sync.sh
# 定时任务：0 * * * * /path/to/feishu-sync/sync.sh >> /path/to/feishu-sync/logs/sync.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPOS_DIR="$SCRIPT_DIR/.repos"

# 加载 .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

# ─── PATH 兜底（兼容 cron / 非交互 shell / 不同机器） ──────
# 覆盖：Homebrew (Apple Silicon / Intel)、nvm、Volta、fnm、Linux 包管理器
EXTRA_PATHS=(
  "$HOME/.local/bin"
  "$HOME/.npm-global/bin"
  "$HOME/.volta/bin"
  "$HOME/.fnm"
  "$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -n1)/bin"
  "/opt/homebrew/bin"
  "/opt/homebrew/sbin"
  "/usr/local/bin"
  "/usr/local/sbin"
)
for p in "${EXTRA_PATHS[@]}"; do
  [ -d "$p" ] && PATH="$p:$PATH"
done
export PATH

# ─── 依赖检查 ──────────────────────────────────────────
require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[ERROR] 找不到命令：$1"
    echo "        当前 PATH=$PATH"
    echo "        请安装后重试（Node.js 20+ / git）"
    exit 1
  }
}
require git
require node
require npx

# ─── 日志目录（项目内，跨平台） ────────────────────────
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[feisync] $(date '+%Y-%m-%d %H:%M:%S') 开始同步"
echo "[feisync] node=$(node -v) npx=$(command -v npx)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── 仓库准备 ──────────────────────────────────────────
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
  echo "[WARN] REPO_ROOT 和 GIT_REPO_URL 均未设置"
fi

# ─── 执行同步 ──────────────────────────────────────────
cd "$SCRIPT_DIR"

case "$1" in
  --report-only)
    echo "[feisync] 仅生成日报..."
    npx tsx src/daily-report.ts
    ;;
  --no-report)
    npx tsx src/sync-to-feishu.ts
    ;;
  *)
    npx tsx src/sync-to-feishu.ts
    echo "[feisync] 生成日报..."
    npx tsx src/daily-report.ts
    ;;
esac

echo "[feisync] $(date '+%Y-%m-%d %H:%M:%S') 同步完成"
