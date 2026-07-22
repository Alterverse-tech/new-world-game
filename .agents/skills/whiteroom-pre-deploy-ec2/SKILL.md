---
name: whiteroom-pre-deploy-ec2
description: Quickly deploy the WhiteRoom project's committed pre_main branch to AWS EC2 instance i-0e676c4509e9c24d1 without unnecessary tests or backup copies. Use when the user asks to rapidly deploy, publish, update, or redeploy WhiteRoom pre_main to whiteroom.13-216-49-19.sslip.io. This skill is only for WhiteRoom; it must not restart or modify Sharky Studio, asset-api, Caddy, or other services sharing the instance.
---

# WhiteRoom pre_main EC2 fast deploy

Deploy the exact committed `pre_main` HEAD to the dedicated WhiteRoom release and PM2 process on the shared EC2 instance.

## Fixed target

- Repository: `Alterverse-tech/new-world-game`
- Branch: `pre_main`
- EC2: `i-0e676c4509e9c24d1`, region `us-east-1`
- SSH user/key: `ubuntu`, `~/.ssh/id_ed25519`
- Runtime root: `/home/ubuntu/whiteroom`
- PM2 process: `whiteroom`
- Local port: `127.0.0.1:8787`
- Public URL: `https://whiteroom.13-216-49-19.sslip.io/`

The same instance also runs Sharky Studio. Never touch `asset-api`, `/home/ubuntu/releases/asset-api`, Caddy, ports used by Studio, or PM2 processes other than `whiteroom`.

## Fast workflow

1. Make sure intended changes are committed on `pre_main`. Do not include unrelated dirty files.
2. Run `scripts/deploy.sh` from any directory inside the repository.
3. Report the deployed commit, active release, PM2 PID, and health result.

The script deliberately:

- resolves the instance's current public IP from AWS every time;
- requires a clean `pre_main` worktree and pushes the exact HEAD;
- creates a new release from `git archive` without making a backup copy;
- reuses current `node_modules` when dependency manifests did not change;
- runs `npm ci --omit=dev` only when dependencies changed;
- restarts only PM2 process `whiteroom`;
- performs only local and public `/healthz` checks;
- automatically switches back to the already-existing previous release if startup fails.

Do not run unit, integration, browser, computer-use, or asset-generation tests unless the user explicitly requests them. Do not create `.deploy-backups` entries or copy the old release. Keeping the pre-existing previous immutable release for immediate rollback is not a new backup.

## Failure handling

- If AWS authentication fails, ask the user to run `aws login`.
- If the instance is not running or has no public IP, stop; never use a remembered IP or another instance.
- If SSH, upload, PM2 startup, or health checks fail, report the exact failure. Do not modify Caddy or investigate Sharky Studio.
- If the worktree is dirty or the current branch is not `pre_main`, stop and ask the user to commit/switch instead of deploying uncommitted files.

## Command

```bash
bash .agents/skills/whiteroom-pre-deploy-ec2/scripts/deploy.sh
```
