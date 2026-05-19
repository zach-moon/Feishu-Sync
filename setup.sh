#!/bin/bash
# ============================================================
# FeiSync 一键安装脚本
# 运行一次即可完成：依赖安装 + lark-cli 登录 + 配置 + 定时任务
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[feisync] 一键安装开始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── 1. 检查 Node.js ───────────────────────────────────────
echo ""
echo "[1/6] 检查 Node.js..."
if ! command -v node &> /dev/null; then
  echo "❌ 未找到 Node.js，请先安装 Node.js 20+"
  echo "   macOS: brew install node"
  echo "   Linux: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 版本过低（当前 $(node -v)），需要 20+"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# ─── 2. 安装 npm 依赖 ──────────────────────────────────────
echo ""
echo "[2/6] 安装脚本依赖..."
cd "$SCRIPTS_DIR"
npm install --silent
echo "✅ npm 依赖安装完成"

# ─── 3. 安装 lark-cli ──────────────────────────────────────
echo ""
echo "[3/6] 安装 lark-cli..."
if ! command -v lark-cli &> /dev/null; then
  npx @larksuite/cli@latest install
  echo "✅ lark-cli 安装完成"
else
  echo "✅ lark-cli 已存在"
fi

# ─── 4. 检查 lark-cli 登录状态 ─────────────────────────────
echo ""
echo "[4/6] 检查飞书登录状态..."
AUTH_STATUS=$(lark-cli auth status 2>/dev/null || echo '{"tokenStatus":"invalid"}')
TOKEN_STATUS=$(echo "$AUTH_STATUS" | grep -o '"tokenStatus":"[^"]*"' | cut -d'"' -f4)

if [ "$TOKEN_STATUS" != "valid" ]; then
  echo "⚠️  未登录或 token 已过期，需要登录飞书"
  echo "   即将打开浏览器进行 OAuth 授权..."
  echo ""
  lark-cli config init --new 2>/dev/null || true
  lark-cli auth login --recommend
  echo "✅ 飞书登录成功"
else
  USER_NAME=$(echo "$AUTH_STATUS" | grep -o '"userName":"[^"]*"' | cut -d'"' -f4)
  echo "✅ 已登录为: $USER_NAME"
fi

# ─── 5. 配置 .env ──────────────────────────────────────────
echo ""
echo "[5/6] 配置环境变量..."
ENV_FILE="$SCRIPTS_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  echo "   .env 文件已存在，跳过配置"
  echo "   如需修改请编辑: $ENV_FILE"
else
  echo ""
  read -p "   请输入飞书多维表格 URL（如 https://xxx.feishu.cn/base/xxx?table=tblxxx）: " FEISHU_URL

  # 解析 URL
  APP_TOKEN=$(echo "$FEISHU_URL" | grep -oE '/base/([^?]+)' | sed 's|/base/||')
  TABLE_ID=$(echo "$FEISHU_URL" | grep -oE 'table=([^&]+)' | sed 's|table=||')

  if [ -z "$APP_TOKEN" ] || [ -z "$TABLE_ID" ]; then
    echo "❌ URL 解析失败，请确认格式正确"
    echo "   格式: https://xxx.feishu.cn/base/<APP_TOKEN>?table=<TABLE_ID>"
    exit 1
  fi

  echo ""
  read -p "   请输入目标仓库的绝对路径（如 /Users/you/project/sproboagent）: " REPO_ROOT

  if [ ! -d "$REPO_ROOT/.kiro/specs" ]; then
    echo "⚠️  警告: $REPO_ROOT/.kiro/specs 目录不存在，确认路径正确？"
    read -p "   继续？(y/n) " CONFIRM
    if [ "$CONFIRM" != "y" ]; then exit 1; fi
  fi

  cat > "$ENV_FILE" << EOF
FEISHU_APP_TOKEN=$APP_TOKEN
FEISHU_TABLE_ID=$TABLE_ID
REPO_ROOT=$REPO_ROOT
DRY_RUN=false
REMOVED_PROTECTION_THRESHOLD=0.30
EOF

  echo "✅ .env 已生成: $ENV_FILE"
fi

# ─── 6. 设置定时任务 ───────────────────────────────────────
echo ""
echo "[6/6] 设置定时任务..."
CRON_SCRIPT="$SCRIPTS_DIR/cron-sync.sh"
CRON_LINE="*/30 * * * * $CRON_SCRIPT >> /tmp/feisync.log 2>&1"

# 检查是否已有 crontab 条目
if crontab -l 2>/dev/null | grep -q "cron-sync.sh"; then
  echo "   定时任务已存在，跳过"
else
  read -p "   是否添加定时任务（每 30 分钟同步一次）？(y/n) " ADD_CRON
  if [ "$ADD_CRON" = "y" ]; then
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "✅ 定时任务已添加"
  else
    echo "   跳过。你可以之后手动添加:"
    echo "   crontab -e"
    echo "   $CRON_LINE"
  fi
fi

# ─── 完成 ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[feisync] ✅ 安装完成！"
echo ""
echo "  手动运行:  cd $SCRIPTS_DIR && npx tsx src/sync-to-feishu.ts"
echo "  查看日志:  tail -f /tmp/feisync.log"
echo "  修改配置:  vim $SCRIPTS_DIR/.env"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
