#!/bin/bash
#
# start-relay.sh — 由 launchd WatchPaths 觸發的 relay 啟動腳本
#
# 觸發方式：任何人（含 Cowork VM 內的 AI）對 .relay-trigger 執行 touch，
# launchd 偵測到 mtime 變動後執行本腳本。
#
# 本腳本在前台 exec relay，由 launchd 直接管理其生命週期（不 daemonize）。
# 若 relay 已在跑則直接退出，重複觸發無害。

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OBSIDIAN_RELAY_PORT:-27182}"

log() { echo "[start-relay $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# --- 1. relay 已在跑就不重複啟動 -------------------------------------------
# relay 只認 POST /exec，其餘路徑回 404；能連上就代表活著。
if curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/" 2>/dev/null; then
  log "relay 已在 port ${PORT} 運作中，跳過啟動"
  exit 0
fi

# 連不上但 port 被別的東西占用 → 不硬搶，留給人類處理
if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  log "警告：port ${PORT} 已被占用但非 relay，放棄啟動"
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN
  exit 1
fi

# --- 2. 定位 obsidian CLI binary --------------------------------------------
# obsidian 這顆 binary 只存在於 app bundle 內（無 /usr/local/bin symlink），
# 該目錄不在 launchd 的預設 PATH 中，故必須主動探測並以 OBSIDIAN_CLI_PATH 告知 relay。
resolve_cli() {
  # 使用者已指定且有效 → 尊重之
  if [ -n "${OBSIDIAN_CLI_PATH:-}" ] && [ -x "${OBSIDIAN_CLI_PATH}" ]; then
    echo "${OBSIDIAN_CLI_PATH}"; return 0
  fi
  # PATH 中找得到（從終端機執行時的常見情形）
  local viapath
  viapath="$(command -v obsidian 2>/dev/null || true)"
  if [ -n "${viapath}" ]; then echo "${viapath}"; return 0; fi
  # 常見安裝位置
  local cand
  for cand in \
    "/Applications/Obsidian.app/Contents/MacOS/obsidian" \
    "${HOME}/Applications/Obsidian.app/Contents/MacOS/obsidian" \
    "/usr/local/bin/obsidian" \
    "/opt/homebrew/bin/obsidian"
  do
    [ -x "${cand}" ] && { echo "${cand}"; return 0; }
  done
  # 最後手段：讓 Spotlight 找 Obsidian.app
  local app
  app="$(mdfind -name 'Obsidian.app' 2>/dev/null | head -1 || true)"
  if [ -n "${app}" ] && [ -x "${app}/Contents/MacOS/obsidian" ]; then
    echo "${app}/Contents/MacOS/obsidian"; return 0
  fi
  return 1
}

if CLI_PATH="$(resolve_cli)"; then
  export OBSIDIAN_CLI_PATH="${CLI_PATH}"
  log "obsidian CLI: ${CLI_PATH}"
else
  log "警告：找不到 obsidian binary，relay 仍會啟動但指令會回 ENOENT"
  log "      請確認已安裝 Obsidian，或手動設定 OBSIDIAN_CLI_PATH"
fi

# --- 3. 確保 Obsidian 在執行 ------------------------------------------------
# relay 只是轉發層，最終仍需執行中的 Obsidian instance 透過 SingletonSocket 接手。
# -g 不搶前景焦點，-a 指定 app。已在跑則為 no-op。
if ! pgrep -x "Obsidian" >/dev/null 2>&1; then
  log "Obsidian 未執行，啟動中…"
  open -ga "Obsidian" || log "警告：無法啟動 Obsidian，relay 仍會起但指令可能失敗"
  # 等 Obsidian 主程序就緒，最多 30 秒
  for _ in $(seq 1 30); do
    pgrep -x "Obsidian" >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Obsidian 主程序起來後，vault 載入與 CLI socket 就緒還需要一點時間
if pgrep -x "Obsidian" >/dev/null 2>&1; then
  log "Obsidian 執行中"
else
  log "警告：等待逾時，Obsidian 未偵測到"
fi

# --- 4. 前台啟動 relay，交由 launchd 管理 ------------------------------------
BUILD="${REPO_DIR}/dist/relay-server.js"
if [ ! -f "${BUILD}" ]; then
  log "錯誤：找不到 ${BUILD}，請先在 ${REPO_DIR} 執行 npm run build"
  exit 1
fi

log "啟動 relay：node ${BUILD} (port ${PORT})"
cd "${REPO_DIR}" || exit 1
exec node "${BUILD}"
