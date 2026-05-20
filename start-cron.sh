#!/usr/bin/env bash
# ============================================================
# FeiSync 定时任务一键启动 (macOS / Linux)
# 运行此脚本后自动设置：
#   - 每小时同步一次飞书表
#   - 每天下午 5 点发送日报到飞书群
#
# Windows 用户请改用任务计划程序 (Task Scheduler) 或 WSL。
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync.sh"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

SYNC_CRON="0 * * * * $SYNC_SCRIPT --no-report >> $LOG_DIR/sync.log 2>&1"
REPORT_CRON="0 17 * * * $SYNC_SCRIPT --report-only >> $LOG_DIR/report.log 2>&1"

echo "[feisync] 设置定时任务..."

# 获取当前 crontab（忽略空的情况）
CURRENT_CRON=$(crontab -l 2>/dev/null || true)

# 用脚本绝对路径作为唯一标识，避免误删其他项目的同名脚本
MARKER_SYNC="$SYNC_SCRIPT --no-report"
MARKER_REPORT="$SYNC_SCRIPT --report-only"

CHANGED=false

if echo "$CURRENT_CRON" | grep -Fq "$MARKER_SYNC"; then
  echo "  ✓ 同步任务已存在，跳过"
else
  CURRENT_CRON="$CURRENT_CRON
$SYNC_CRON"
  CHANGED=true
  echo "  + 添加：每小时同步一次"
fi

if echo "$CURRENT_CRON" | grep -Fq "$MARKER_REPORT"; then
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
crontab -l 2>/dev/null | grep -F "$SCRIPT_DIR" || echo "  (无)"
echo ""
echo "日志位置："
echo "  同步日志: $LOG_DIR/sync.log"
echo "  日报日志: $LOG_DIR/report.log"
echo ""
echo "管理命令："
echo "  查看: crontab -l"
echo "  停止: crontab -l | grep -vF \"$SCRIPT_DIR\" | crontab -"
