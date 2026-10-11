# C720P host Wi-Fi ingress hardening — staged, not active

## Baseline confirmed on 2026-10-11

C720P `wlp1s0` currently uses IPv4 `192.168.178.141/24` behind `192.168.178.1`, plus local IPv6 ULA and a global IPv6 address. The existing root-managed firewall file uses `policy accept` and explicitly protects only TCP 22 and 8123.

The proposed `step4-wifi-ingress.nft` retains established traffic, loopback and the local IPv4/ULA/link-local IPv6 network, and blocks all unsolicited inbound packets from other source networks arriving on `wlp1s0`. This also protects listener ports 8766, 8787, 8794, 8796, 10701, 18555, and future services from non-local unsolicited traffic. It does **not** isolate one home-LAN client from another, or close Android ADB port 5555 on the phones. It does **not** change Docker's forwarding chains.

## Why it was not activated

The audited C720P maintenance user can execute ordinary system diagnostics, but the root-owned firewall is not writable and the only available passwordless sudo command is an unrelated, root-only preinstalled helper. Attempts to read active nftables rules or run privileged nftables commands failed for lack of authority. No router-level admin control was established.

Do not assume the staged rules are in force. Do not disable SSH, Supabase outbound job polling, or the camera tunnel to force this change.

## Before activation with an authorized root-capable connection

1. Confirm current interface name, DHCP subnet, any alternate trusted IPv4 LAN/VPN and local IPv6 client ranges. Do not cut off devices using global IPv6 for local Home Assistant access.
2. Keep an independent working management route, root-owned backup of `/etc/c720p-security/firewall.nft`, and automatic timed rollback if reachability checks fail.
3. Validate the nftables rules offline using the host's installed nftables version. Apply the replacement transactionally without altering Docker's forward chain.
4. Confirm localhost HA 8123, security tunnel, C720P agent heartbeats, SSH from an authorized LAN client, camera 8794, and ADB to all three phones; then verify an external untrusted source cannot reach listeners.
5. Cancel rollback only after all checks pass. Update the root-managed firewall source and service for reboot persistence.

Current additional protection deployed separately: private C720P security media sessions (GitHub PR #498) and local/LAN filtering for OAuth UI 8766/8796 (PR #500, source merge pending).
