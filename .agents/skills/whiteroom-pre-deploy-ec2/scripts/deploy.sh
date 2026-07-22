#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="i-0e676c4509e9c24d1"
AWS_REGION="us-east-1"
DEPLOY_BRANCH="pre_main"
SSH_USER="ubuntu"
SSH_KEY="${HOME}/.ssh/id_ed25519"
REMOTE_ROOT="/home/ubuntu/whiteroom"
PUBLIC_HEALTH_URL="https://whiteroom.13-216-49-19.sslip.io/healthz"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$DEPLOY_BRANCH" ]]; then
  echo "ERROR: current branch is $current_branch; expected $DEPLOY_BRANCH" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: worktree is dirty; commit or remove unrelated changes before deploy" >&2
  exit 1
fi

target_sha="$(git rev-parse HEAD)"
short_sha="$(git rev-parse --short=8 "$target_sha")"

echo "==> Push exact $DEPLOY_BRANCH commit $short_sha"
git push origin "$DEPLOY_BRANCH"

instance_state="$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text)"
instance_host="$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)"

if [[ "$instance_state" != "running" || -z "$instance_host" || "$instance_host" == "None" ]]; then
  echo "ERROR: $INSTANCE_ID is not running with a public IP" >&2
  exit 1
fi

active_release="$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 \
  "$SSH_USER@$instance_host" "readlink -f $REMOTE_ROOT/current")"
active_name="$(basename "$active_release")"
active_short_sha="$(cut -d- -f3 <<<"$active_name")"

install_dependencies=1
if git rev-parse --verify "${active_short_sha}^{commit}" >/dev/null 2>&1 && \
  git diff --quiet "$active_short_sha" "$target_sha" -- package.json package-lock.json; then
  install_dependencies=0
fi

archive="/tmp/whiteroom-${short_sha}-premain.tar.gz"
remote_archive="$REMOTE_ROOT/whiteroom-${short_sha}-premain.tar.gz"
trap 'rm -f "$archive"' EXIT

echo "==> Archive and upload $short_sha"
git archive --format=tar.gz --output="$archive" "$target_sha"
scp -i "$SSH_KEY" -o BatchMode=yes "$archive" "$SSH_USER@$instance_host:$remote_archive"

echo "==> Activate WhiteRoom release"
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_USER@$instance_host" bash -s -- \
  "$remote_archive" "$short_sha" "$install_dependencies" <<'REMOTE_DEPLOY'
set -euo pipefail

archive="$1"
short_sha="$2"
install_dependencies="$3"
root="/home/ubuntu/whiteroom"
previous_release="$(readlink -f "$root/current")"
timestamp="$(date +%Y%m%d-%H%M%S)"
new_release="$root/releases/${timestamp}-${short_sha}-premain"
switched=0

export PATH="/home/ubuntu/node/bin:$PATH"

rollback() {
  trap - ERR
  if [[ "$switched" == 1 ]]; then
    ln -sfn "$previous_release" "$root/current"
    pm2 delete whiteroom >/dev/null 2>&1 || true
    pm2 start /usr/bin/bash --name whiteroom --cwd "$previous_release" -- \
      -lc "set -a; . /home/ubuntu/whiteroom/.env; set +a; exec /home/ubuntu/node/bin/node src/server.js" >/dev/null
    sleep 2
    pm2 save >/dev/null
  fi
  echo "ERROR: deploy failed; active release restored to $previous_release" >&2
  exit 1
}
trap rollback ERR

mkdir "$new_release"
tar -xzf "$archive" -C "$new_release"

if [[ "$install_dependencies" == 1 ]]; then
  (cd "$new_release" && npm ci --omit=dev)
else
  node_modules="$(readlink -f "$previous_release/node_modules")"
  test -d "$node_modules"
  ln -s "$node_modules" "$new_release/node_modules"
fi

ln -sfn "$new_release" "$root/current"
switched=1

pm2 delete whiteroom >/dev/null 2>&1 || true
pm2 start /usr/bin/bash --name whiteroom --cwd "$new_release" -- \
  -lc "set -a; . /home/ubuntu/whiteroom/.env; set +a; exec /home/ubuntu/node/bin/node src/server.js" >/dev/null
sleep 2
curl -fsS --max-time 8 http://127.0.0.1:8787/healthz >/dev/null
test "$(readlink -f /proc/$(pm2 pid whiteroom)/cwd)" = "$new_release"
pm2 save >/dev/null
rm -f "$archive"
trap - ERR

printf "ACTIVE=%s\nPREVIOUS=%s\nPM2_PID=%s\nLOCAL_HEALTH=200\n" \
  "$new_release" "$previous_release" "$(pm2 pid whiteroom)"
REMOTE_DEPLOY

curl -fsS --max-time 12 "$PUBLIC_HEALTH_URL" >/dev/null
echo "PUBLIC_HEALTH=200"
echo "DEPLOYED_COMMIT=$target_sha"
