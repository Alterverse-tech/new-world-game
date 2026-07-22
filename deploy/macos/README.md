# WhiteRoom shared development environment (macOS)

Public test entry:

`https://handcart-stroller-flop.ngrok-free.dev/whiteroom-dev`

The setup keeps the backend private on `127.0.0.1:8787`, serves the tracked
`public/game/` build on `127.0.0.1:4174`, and exposes only port 4174 through
the account's fixed ngrok HTTPS endpoint. The local gateway lives at
`deploy/macos/whiteroom-game-server.mjs`; runtime no longer depends on the
ignored `tmp/` directory. Supabase Auth redirects are configured for the
public origin.

## Manage services

```bash
./deploy/macos/whiteroom-dev.sh status
./deploy/macos/whiteroom-dev.sh restart
./deploy/macos/whiteroom-dev.sh logs
./deploy/macos/whiteroom-dev.sh stop
./deploy/macos/whiteroom-dev.sh start
```

The three LaunchAgents start automatically after this Mac user logs in and
restart if a process exits. The Mac must remain awake and connected to the
internet while coworkers test.

## Team SSH access

The shared, non-admin account is `whiteroomdev`. It accepts public-key login
only. Each trusted developer must have their own public key added to:

`/Users/whiteroomdev/.ssh/authorized_keys`

From the same LAN:

```bash
ssh whiteroomdev@192.168.31.179
cd /Users/cppeng/Downloads/project/new-world-game
sudo whiteroom-team-admin status
sudo whiteroom-team-admin restart
sudo whiteroom-team-admin logs
sudo whiteroom-team-admin pull
sudo whiteroom-team-admin deploy
```

`deploy` performs a fast-forward-only pull of the currently checked-out branch
and restarts the three services. It refuses to overwrite conflicting local
changes. Developers who can edit and restart server code are trusted code
deployers: deployed code can access the application's runtime credentials.
