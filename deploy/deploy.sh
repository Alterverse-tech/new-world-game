#!/usr/bin/env bash
# 《眠海》平台单机部署脚本（在生产主机上执行）
# 用法：
#   ./deploy/deploy.sh [git-ref]        # 默认部署 main；可指定分支/标签/提交
# 前提：
#   - 代码位于 /opt/whiteroom/app（首次：sudo git clone <repo> /opt/whiteroom/app）
#   - systemd 单元 whiteroom.service 已按 deploy/whiteroom.service 安装
set -euo pipefail

APP_DIR="${WHITEROOM_APP_DIR:-/opt/whiteroom/app}"
REF="${1:-main}"
HEALTH_URL="${WHITEROOM_HEALTH_URL:-http://127.0.0.1:8787/healthz}"

cd "$APP_DIR"

echo "==> 拉取 $REF"
git fetch origin "$REF"
git checkout --detach FETCH_HEAD

echo "==> 安装生产依赖"
npm ci --omit=dev

echo "==> 运行测试（可用 WHITEROOM_SKIP_TESTS=1 跳过）"
if [ "${WHITEROOM_SKIP_TESTS:-0}" != "1" ]; then
  npm install --no-save --omit=optional >/dev/null 2>&1 || true
  npm test
  npm prune --omit=dev >/dev/null
fi

echo "==> 重启服务"
sudo systemctl restart whiteroom

echo "==> 健康检查"
for attempt in $(seq 1 10); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> 部署完成：$(git rev-parse --short HEAD) 已上线"
    exit 0
  fi
  sleep 2
done

echo "!! 健康检查失败，请查看：journalctl -u whiteroom -n 50" >&2
exit 1
