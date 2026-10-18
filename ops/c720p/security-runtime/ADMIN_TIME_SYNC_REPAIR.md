# Remaining administrator action: restore automatic clock synchronization

The hub reported `NTP=no`, `NTPSynchronized=no`, and no installed
systemd-timesyncd package/unit. Its UTC clock was about 88 seconds behind a
TLS-authenticated server Date response. The media origin rejects token issue
times more than 60 seconds in the future, so this drift can reject freshly
issued tokens. Authentication checks have been preserved.

The available maintenance account could not install the missing package or
enable NTP noninteractively: both actual sudo commands returned
`sudo: a password is required`. A successful sudo command-list query did not
establish passwordless execution. No alternative privileged route was used.

An administrator on the C720P can apply the standard Debian service repair:

```sh
sudo apt-get install --no-install-recommends systemd-timesyncd
sudo timedatectl set-ntp true
timedatectl status
timedatectl timesync-status
```

Review the package transaction before accepting it. After the service reaches
a time server, verify that NTP is active and the system clock is synchronized.
Keep the existing Europe/Amsterdam timezone. If synchronization does not occur,
inspect the service log and network reachability rather than changing token
validation rules:

```sh
journalctl -u systemd-timesyncd --no-pager -n 30
```

No clock change or time-service installation was completed by this audit. The
camera and runtime fixes have their own independent deployment verification.
