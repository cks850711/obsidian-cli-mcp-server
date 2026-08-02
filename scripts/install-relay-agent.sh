#!/bin/bash
#
# install-relay-agent.sh — 安裝 launchd WatchPaths agent（方案 B：觸發式啟動）
#
# 本腳本在執行當下「生成」plist，repo 內不保存任何含絕對路徑的設定檔。
# 路徑由腳本自身位置推導，使用者無需填寫任何東西。
#
#   安裝：  bash scripts/install-relay-agent.sh
#   移除：  bash scripts/install-relay-agent.sh --uninstall
#
# 安裝後，任何人（含 Cowork VM 內的 AI）只要 touch 觸發檔，
# 主機 launchd 就會啟動 relay。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.obsidian-cli-mcp-server.relay"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
TRIGGER="${REPO_DIR}/.relay-trigger"
DOMAIN="gui/$(id -u)"

# --- 移除模式 ---------------------------------------------------------------
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  rm -f "${PLIST}"
  echo "已移除 ${LABEL}"
  echo "（${TRIGGER} 與 logs/ 保留，如不需要請自行刪除）"
  exit 0
fi

# --- 前置檢查 ---------------------------------------------------------------
if [ ! -f "${REPO_DIR}/dist/relay-server.js" ]; then
  echo "錯誤：找不到 dist/relay-server.js，請先執行 npm run build" >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "錯誤：PATH 中找不到 node" >&2
  exit 1
fi
NODE_DIR="$(dirname "${NODE_BIN}")"

mkdir -p "${REPO_DIR}/logs" "${HOME}/Library/LaunchAgents"
touch "${TRIGGER}"
chmod +x "${REPO_DIR}/scripts/start-relay.sh"

# --- 生成 plist -------------------------------------------------------------
# 刻意不設 RunAtLoad / KeepAlive：純觸發式，relay 只在 touch 觸發檔時啟動。
cat > "${PLIST}" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>WatchPaths</key>
    <array>
        <string>${TRIGGER}</string>
    </array>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${REPO_DIR}/scripts/start-relay.sh</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${NODE_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${REPO_DIR}/logs/relay.log</string>
    <key>StandardErrorPath</key>
    <string>${REPO_DIR}/logs/relay.log</string>
</dict>
</plist>
PLIST_EOF

plutil -lint "${PLIST}" >/dev/null

# --- 載入（先清掉同 label 的舊版，讓重複執行本腳本是安全的）------------------
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"

echo "已安裝 ${LABEL}"
echo
echo "  plist    : ${PLIST}"
echo "  觸發檔   : ${TRIGGER}"
echo "  log      : ${REPO_DIR}/logs/relay.log"
echo
echo "測試：touch \"${TRIGGER}\" 後等數秒，relay 應自行啟動"
