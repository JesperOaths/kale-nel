#!/usr/bin/env bash
# Install fail-closed native ADB bridge ordering for S9 catalog/recovery readers.
# Does not start a scanner, change camera/media, or install an Android worker.
set -euo pipefail
ROOT="${HOME}/.config/systemd/user"
BRIDGE="c720p-s9-native-camera-bridge.service"
for unit in   c720p-s9-auxiliary-recovery-refresh-v1.service   c720p-s9-local-sd-catalog.service   c720p-s9-standalone-catalog.service
do
  test -f "${ROOT}/${unit}" || { echo "missing_owned_unit:${unit}" >&2; exit 2; }
  dropdir="${ROOT}/${unit}.d"
  target="${dropdir}/10-require-native-status-bridge.conf"
  mkdir -p "${dropdir}"
  tmp="$(mktemp "${dropdir}/.bridge-guard.XXXXXXXX")"
  printf '[Unit]\n# Prepare native phone status forwarding before the owned metadata/recovery job.\nRequires=%s\nAfter=%s\n' "${BRIDGE}" "${BRIDGE}" > "${tmp}"
  chmod 0644 "${tmp}"
  if test -e "${target}"; then
    # Existing on-host comments are allowed; preserve a semantically identical
    # installed guard rather than changing or overwriting its operator notes.
    if ! grep -Fxq "Requires=${BRIDGE}" "${target}" ||
       ! grep -Fxq "After=${BRIDGE}" "${target}"; then
      rm -f "${tmp}"
      echo "different_existing_dropin_refuse:${target}" >&2
      exit 3
    fi
    rm -f "${tmp}"
  else
    mv -n "${tmp}" "${target}"
  fi
done
systemctl --user daemon-reload
for unit in   c720p-s9-auxiliary-recovery-refresh-v1.service   c720p-s9-local-sd-catalog.service   c720p-s9-standalone-catalog.service
do
  systemctl --user show "${unit}" -p Requires -p After --no-pager |
    grep -q "${BRIDGE}" || { echo "missing_effective_dependency:${unit}" >&2; exit 4; }
done
echo "BRIDGE_PRECONDITIONS_INSTALLED_NO_WORKERS_LAUNCHED"
