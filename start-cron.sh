#!/bin/bash
# ============================================================
# FeiSync 定时任务一键启动
# 运行此脚本后自动设置：
#   - 每小时同步一次飞书表
#   - 每天下午 5 点发送日报到飞书群
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync.sh"
REPORT_CMD="cd $SCRIPT_DIR && npx tsx src/daily-report.ts"

SYNC_CRON="0 * * * * $SYNC_SCRIPT >> /tmp/feisync.log 2>&1"
REPORT_CRON="0 17 * * * $REPORT_CMD >> /tmp/feisync-report.log 2>&1"

echo "[feisync] 设置定时任务..."

# 获取当前 crontab（忽略空的情况）
CURRENT_CRON=$(crontab -l 2>/dev/null || true)

# 检查是否已存在
CHANGED=false

if echo "$CURRENT_CRON" | grep -q "sync.sh"; then
  echo "  ✓ 同步任务已存在，跳过"
else
  CURRENT_CRON="$CURRENT_CRON
$SYNC_CRON"
  CHANGED=true
  echo "  + 添加：每小时同步一次"
fi

if echo "$CURRENT_CRON" | grep -q "daily-report"; then
  echo "  ✓ 日报任务已存在，跳过"
else
  CURRENT_CRON="$CURRENT_CRON
$REPORT_CRON"
  CHANGED=true
  echo "  + 添加：每天 17:00 发送日报"
fi

if [ "$CHANGED" = true ]; then
  echo "$CURRENT_CRON" | crontab -
  echo ""
  echo "[feisync] ✅ 定时任务已设置完成"
else
  echo ""
  echo "[feisync] ✅ 定时任务无变化"
fi

echo ""
echo "当前 crontab："
crontab -l 2>/dev/null | grep -E "feisync|sync\.sh|daily-report" || echo "  (无)"
echo ""
echo "日志位置："
echo "  同步日志: /tmp/feisync.log"
echo "  日报日志: /tmp/feisync-report.log"
echo ""
echo "管理命令："
echo "  查看: crontab -l"
echo "  停止: crontab -l | grep -v feisync | grep -v sync.sh | grep -v daily-report | crontab -"
