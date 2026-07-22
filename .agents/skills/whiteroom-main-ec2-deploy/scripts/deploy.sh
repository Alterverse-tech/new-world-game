#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="i-0187ad0a786f2ddb3"
REGION="us-east-1"
BRANCH="main"
PUBLIC_HEALTH="https://altverse.fun/healthz"

cd "$(git rev-parse --show-toplevel)"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || {
  echo "ERROR: switch to $BRANCH before deploy" >&2
  exit 1
}
[[ -z "$(git status --porcelain)" ]] || {
  echo "ERROR: commit or remove dirty worktree changes before deploy" >&2
  exit 1
}

target_sha="$(git rev-parse HEAD)"
short_sha="$(git rev-parse --short=8 HEAD)"

echo "==> Push $BRANCH@$short_sha"
git push origin "$BRANCH"

state="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' --output text)"
[[ "$state" == "running" ]] || {
  echo "ERROR: $INSTANCE_ID is not running" >&2
  exit 1
}

parameters="$(python3 - "$target_sha" "$short_sha" <<'PYTHON'
import json
import sys

target, short = sys.argv[1:]
command = r'''set -euo pipefail
target="__TARGET__"
short="__SHORT__"
repo=/opt/whiteroom/app
root=/opt/whiteroom-platform
service=whiteroom-platform.service

git -c safe.directory="$repo" -C "$repo" fetch --quiet origin main
[[ "$(git -c safe.directory="$repo" -C "$repo" rev-parse FETCH_HEAD)" == "$target" ]]

previous="$(readlink -f "$root/current")"
active_short="$(basename "$previous" | cut -d- -f3)"
release="$root/releases/$(date +%Y%m%d-%H%M%S)-$short"
switched=0

rollback() {
  trap - ERR
  if [[ "$switched" == 1 ]]; then
    ln -sfn "$previous" "$root/current"
    systemctl restart "$service"
  fi
  echo "ERROR: deploy failed; restored $previous" >&2
  exit 1
}
trap rollback ERR

mkdir "$release"
git -c safe.directory="$repo" -C "$repo" archive "$target" | tar -x -C "$release"

if git -c safe.directory="$repo" -C "$repo" cat-file -e "${active_short}^{commit}" 2>/dev/null && \
   git -c safe.directory="$repo" -C "$repo" diff --quiet "$active_short" "$target" -- package.json package-lock.json; then
  modules="$(readlink -f "$previous/node_modules")"
  [[ -d "$modules" ]]
  ln -s "$modules" "$release/node_modules"
else
  (cd "$release" && npm ci --omit=dev)
fi

ln -sfn "$release" "$root/current"
switched=1
systemctl restart "$service"
sleep 2
systemctl is-active --quiet "$service"
curl -fsS --max-time 8 http://127.0.0.1:8787/healthz >/dev/null
pid="$(systemctl show "$service" --property MainPID --value)"
[[ "$pid" -gt 0 ]]
[[ "$(readlink -f "/proc/$pid/cwd")" == "$release" ]]
trap - ERR

printf 'ACTIVE=%s\nPREVIOUS=%s\nSYSTEMD_PID=%s\nLOCAL_HEALTH=200\n' "$release" "$previous" "$pid"
'''
command = command.replace('__TARGET__', target).replace('__SHORT__', short)
print(json.dumps({'commands': [command]}))
PYTHON
)"

echo "==> Deploy through SSM"
command_id="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "WhiteRoom main deploy $short_sha" \
  --parameters "$parameters" --query 'Command.CommandId' --output text)"

wait_code=0
aws ssm wait command-executed --region "$REGION" --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" || wait_code=$?

status="$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" --query Status --output text)"
stdout="$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" --query StandardOutputContent --output text)"
stderr="$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" --query StandardErrorContent --output text)"

[[ "$stdout" == "None" ]] || printf '%s\n' "$stdout"
[[ "$stderr" == "None" || -z "$stderr" ]] || printf '%s\n' "$stderr" >&2
[[ "$wait_code" == 0 && "$status" == "Success" ]] || {
  echo "ERROR: SSM deployment status is $status" >&2
  exit 1
}

curl -fsS --max-time 12 "$PUBLIC_HEALTH" >/dev/null
echo "PUBLIC_HEALTH=200"
echo "DEPLOYED_COMMIT=$target_sha"
