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
- Nginx static symlink: `/var/www/whiteroom/current`
- Required static target: `<active release>/public/game`
- Service: `whiteroom-platform.service`
- Data: `/var/lib/whiteroom-platform`
- Public URL: `https://altverse.fun/`

Ignore the inactive legacy `whiteroom.service`. Never change Nginx, `/etc/whiteroom-platform.env`, persistent data, or unrelated services.

Nginx serves `/`, `index.html`, and bundled frontend assets directly from `/var/www/whiteroom/current`; it does not obtain them from the systemd process. API routes and `/healthz` are proxied to `whiteroom-platform.service`. Therefore a healthy service does not prove that the public frontend changed.

## Required release switching

For every deployment, make both symlinks refer to the same immutable release:

- `/opt/whiteroom-platform/current` → the new release root.
- `/var/www/whiteroom/current` → the new release's `public/game` directory.

Switch the existing static symlink; do not edit or reload Nginx, create a second static release copy, or create a backup directory. On startup failure, restore both pre-existing symlink targets before restarting `whiteroom-platform.service` on the previous release.

## Workflow

1. Require a clean `main` worktree containing only committed changes.
2. Run `scripts/deploy.sh`.
3. Confirm its `ACTIVE` and `STATIC` values satisfy `STATIC=$ACTIVE/public/game`.
4. Perform one lightweight public HTML check and confirm `https://altverse.fun/` contains the expected current `index.html` markers or assets from `main` HEAD. Do not treat `/healthz` alone as frontend verification.
5. Report the commit, active release, static target, systemd PID, and local/public health results.

The script pushes the exact commit, sends one SSM deployment command, creates a new immutable release, reuses `node_modules` unless dependencies changed, switches both required symlinks, restarts only `whiteroom-platform.service`, and checks local/public `/healthz`.

Do not run unit, integration, browser, computer-use, or asset-generation tests unless explicitly requested. Do not create backup directories or copy the old release. Reusing the already-existing previous release for automatic rollback is allowed.

If AWS authentication fails, ask the user to run `aws login`. If the instance or SSM is unavailable, stop without trying another instance. If the branch is wrong or the worktree is dirty, ask the user to commit or switch branches. If `/healthz` succeeds but the public HTML is stale, inspect the two symlink targets through read-only SSM commands and report the mismatch; never fix it by changing Nginx.

## Command

```bash
bash .agents/skills/whiteroom-main-ec2-deploy/scripts/deploy.sh
```
