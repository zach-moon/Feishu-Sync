#!/usr/bin/env bash
# ============================================================
# FeiSync 定时任务安装（macOS launchd）
#
# 为什么用 launchd 而不是 cron？
#   macOS 的 cron 跑在系统级守护进程里，不在用户登录 session。
#   会导致：
#     1. 拿不到 Keychain（lark-cli 发飞书会失败）
#     2. 访问不了 ~/Documents、~/Desktop 等受保护目录
#   launchd LaunchAgent 跑在用户 session 里，两个问题都没有。
#
# 用法：
#   ./install-launchd.sh           # 安装并启动
#   ./install-launchd.sh uninstall # 卸载
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/launchd"
DST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/feisync"

PLISTS=(
  "com.feisync.sync.plist"
  "com.feisync.report.plist"
)

mkdir -p "$DST_DIR"
mkdir -p "$LOG_DIR"

uninstall() {
  for plist in "${PLISTS[@]}"; do
    label="${plist%.plist}"
    target="$DST_DIR/$plist"
    if [ -f "$target" ]; then
      echo "  - 卸载 $label"
      launchctl unload "$target" 2>/dev/null || true
      rm -f "$target"
    fi
  done
}

install() {
  for plist in "${PLISTS[@]}"; do
    label="${plist%.plist}"
    src="$SRC_DIR/$plist"
    dst="$DST_DIR/$plist"

    [ -f "$src" ] || { echo "[ERROR] 找不到 $src"; exit 1; }

    # 已存在就先 unload，避免重复加载
    if [ -f "$dst" ]; then
      launchctl unload "$dst" 2>/dev/null || true
    fi

    cp "$src" "$dst"
    launchctl load "$dst"
    echo "  ✓ 已加载 $label"
  done
}

case "${1:-install}" in
  uninstall|remove)
    echo "[feisync] 卸载 LaunchAgent..."
    uninstall
    echo "[feisync] ✅ 卸载完成"
    ;;
  install|*)
    echo "[feisync] 安装 LaunchAgent..."
    install
    echo ""
    echo "[feisync] ✅ 安装完成"
    echo ""
    echo "已注册任务："
    launchctl list | grep -E "com\.feisync\." || echo "  (无)"
    echo ""
    echo "调度："
    echo "  com.feisync.sync   每小时整点 → ~/Library/Logs/feisync/sync.log"
    echo "  com.feisync.report 每天 17:00 → ~/Library/Logs/feisync/report.log"
    echo ""
    echo "管理命令："
    echo "  立即触发: launchctl kickstart -k gui/\$(id -u)/com.feisync.report"
    echo "  查看状态: launchctl list | grep com.feisync"
    echo "  卸载:    ./install-launchd.sh uninstall"
    ;;
esac
