#!/bin/bash
set -euo pipefail

if [[ "$(/usr/bin/id -u)" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

source_dir="$(/usr/bin/dirname "$0")"
dev_user="whiteroomdev"
dev_home="/Users/$dev_user"
ssh_config_target="/etc/ssh/sshd_config.d/110-whiteroomdev.conf"
cd "$source_dir"

if ! /usr/bin/id "$dev_user" >/dev/null 2>&1; then
  generated_password="$(/usr/bin/openssl rand -base64 48)"
  /usr/sbin/sysadminctl \
    -addUser "$dev_user" \
    -fullName "WhiteRoom Dev" \
    -home "$dev_home" \
    -shell /bin/zsh \
    -password "$generated_password"
  unset generated_password
fi

/usr/bin/dscl . -create "/Users/$dev_user" IsHidden 1
/usr/sbin/createhomedir -c -u "$dev_user" >/dev/null
/usr/sbin/dseditgroup -o edit -a "$dev_user" -t user com.apple.access_ssh

/bin/mkdir -p "$dev_home/.ssh" /usr/local/sbin /etc/sudoers.d
/usr/sbin/chown "$dev_user":staff "$dev_home/.ssh"
/bin/chmod 700 "$dev_home/.ssh"

if [[ ! -e "$dev_home/.ssh/authorized_keys" ]]; then
  /usr/bin/install -o "$dev_user" -g staff -m 600 \
    /Users/cppeng/.ssh/id_ed25519.pub "$dev_home/.ssh/authorized_keys"
fi

/usr/bin/install -o "$dev_user" -g staff -m 600 \
  "$source_dir/whiteroomdev.gitconfig" "$dev_home/.gitconfig"
/usr/bin/install -o root -g wheel -m 755 \
  "$source_dir/whiteroom-team-admin" /usr/local/sbin/whiteroom-team-admin
/usr/bin/install -o root -g wheel -m 440 \
  "$source_dir/whiteroomdev.sudoers" /etc/sudoers.d/whiteroomdev
/usr/sbin/visudo -cf /etc/sudoers.d/whiteroomdev
/usr/bin/ssh-keygen -A

previous_config=""
if [[ -e "$ssh_config_target" ]]; then
  previous_config="/private/tmp/110-whiteroomdev.conf.backup.$$"
  /bin/cp "$ssh_config_target" "$previous_config"
fi
/usr/bin/install -o root -g wheel -m 644 \
  "$source_dir/sshd-whiteroomdev.conf" "$ssh_config_target"
if ! /usr/sbin/sshd -t; then
  if [[ -n "$previous_config" ]]; then
    /bin/cp "$previous_config" "$ssh_config_target"
  else
    /bin/rm "$ssh_config_target"
  fi
  echo "SSH configuration validation failed; previous config restored." >&2
  exit 1
fi
if [[ -n "$previous_config" ]]; then
  /bin/rm "$previous_config"
fi

/usr/sbin/systemsetup -setremotelogin on
echo "WhiteRoom SSH account installed: $dev_user"
