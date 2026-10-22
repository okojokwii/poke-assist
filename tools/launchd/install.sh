#!/bin/zsh
# 常駐の入れ外し（DESIGN.md §8。読み取りの精度が固まってから使う）
#   tools/launchd/install.sh          入れる（ログイン時に起動。助言の窓は http://127.0.0.1:8765）
#   tools/launchd/install.sh remove   外す
set -eu
DIR=$(cd "$(dirname "$0")/../.." && pwd)
DEST=~/Library/LaunchAgents/com.poke-assist.advisor.plist
if [[ "${1:-}" == "remove" ]]; then
  launchctl bootout "gui/$(id -u)" "$DEST" 2>/dev/null || true
  rm -f "$DEST"
  echo "外しました"
  exit 0
fi
mkdir -p "$DIR/captures"
sed -e "s|__DIR__|$DIR|g" -e "s|__NODE__|$(command -v node)|g" -e "s|__PATH__|$PATH|g" \
  "$DIR/tools/launchd/com.poke-assist.advisor.plist" > "$DEST"
launchctl bootout "gui/$(id -u)" "$DEST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "入れました: $DEST（ログ: $DIR/captures/advisor.log）"
