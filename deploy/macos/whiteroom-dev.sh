#!/usr/bin/env bash
set -euo pipefail

repo="/Users/cppeng/Downloads/project/new-world-game"
agent_dir="/Users/cppeng/Library/LaunchAgents"
domain="gui/501"
labels=(
  com.whiteroom.dev.backend
  com.whiteroom.dev.game
  com.whiteroom.dev.ngrok
)

patch_game() {
  if [[ -f "$repo/tmp/whiteroom-game/index.html" ]]; then
    node "$repo/deploy/macos/patch-whiteroom-game.mjs"
  fi
}

install_agents() {
  patch_game
  mkdir -p "$agent_dir" "$repo/var/log"
  for label in "${labels[@]}"; do
    source_plist="$repo/deploy/macos/$label.plist"
    target_plist="$agent_dir/$label.plist"
    launchctl bootout "$domain" "$target_plist" 2>/dev/null || true
    /usr/bin/ditto "$source_plist" "$target_plist"
    launchctl bootstrap "$domain" "$target_plist"
  done
}

stop_agents() {
  for label in "${labels[@]}"; do
    launchctl bootout "$domain" "$agent_dir/$label.plist" 2>/dev/null || true
  done
}

restart_agents() {
  patch_game
  for label in "${labels[@]}"; do
    launchctl kickstart -k "$domain/$label"
  done
}

show_status() {
  for label in "${labels[@]}"; do
    echo "$label"
    launchctl print "$domain/$label" 2>/dev/null | sed -n -E '/state =|pid =|last exit code =/p' || echo "  not loaded"
  done
  echo "public: https://handcart-stroller-flop.ngrok-free.dev/whiteroom-dev"
}

case "${1:-status}" in
  install) install_agents ;;
  start) install_agents ;;
  stop) stop_agents ;;
  restart) restart_agents ;;
  status) show_status ;;
  logs) tail -n 80 "$repo"/var/log/whiteroom-*.log ;;
  *) echo "Usage: $0 {install|start|stop|restart|status|logs}" >&2; exit 2 ;;
esac
