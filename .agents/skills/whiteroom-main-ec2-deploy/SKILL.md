---
name: whiteroom-main-ec2-deploy
description: Quickly deploy the WhiteRoom project's committed main branch to AWS EC2 instance i-0187ad0a786f2ddb3 without unnecessary tests or backup copies. Use when the user asks to rapidly deploy, publish, update, or redeploy WhiteRoom main to altverse.fun. This skill is only for the main production instance and must use whiteroom-platform.service through AWS SSM.
---

# WhiteRoom main EC2 fast deploy

Deploy the exact committed `main` HEAD with one script invocation.

## Fixed target

- Branch: `main`
- EC2: `i-0187ad0a786f2ddb3`, region `us-east-1`
- Management: AWS SSM, not SSH
- Git checkout: `/opt/whiteroom/app`
- Releases: `/opt/whiteroom-platform/releases`
- Active symlink: `/opt/whiteroom-platform/current`
- Service: `whiteroom-platform.service`
- Data: `/var/lib/whiteroom-platform`
- Public URL: `https://altverse.fun/`

Ignore the inactive legacy `whiteroom.service`. Never change Nginx, `/etc/whiteroom-platform.env`, persistent data, or unrelated services.

## Workflow

1. Require a clean `main` worktree containing only committed changes.
2. Run `scripts/deploy.sh`.
3. Report the commit, new release, systemd PID, and health result.

The script pushes the exact commit, sends one SSM deployment command, creates a new immutable release, reuses `node_modules` unless dependencies changed, restarts only `whiteroom-platform.service`, and checks only local/public `/healthz`.

Do not run unit, integration, browser, computer-use, or asset-generation tests unless explicitly requested. Do not create backup directories or copy the old release. Reusing the already-existing previous release for automatic rollback is allowed.

If AWS authentication fails, ask the user to run `aws login`. If the instance or SSM is unavailable, stop without trying another instance. If the branch is wrong or the worktree is dirty, ask the user to commit or switch branches.

## Command

```bash
bash .agents/skills/whiteroom-main-ec2-deploy/scripts/deploy.sh
```
