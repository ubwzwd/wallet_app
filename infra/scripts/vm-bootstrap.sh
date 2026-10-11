#!/usr/bin/env bash
# infra/scripts/vm-bootstrap.sh -- one-time (re-runnable) initialisation of the deploy VM.
#
# Target: Canonical Ubuntu 24.04 on OCI (VM.Standard.A1.Flex / arm64), login user `ubuntu`.
# Run it from the laptop:
#     ssh wallet-vm 'bash -s' < infra/scripts/vm-bootstrap.sh
# or let deploy.sh do it:   bash infra/scripts/deploy.sh --bootstrap
#
# What it does (every step is idempotent):
#   a. apt update + dist-upgrade, base packages
#   b. Docker CE from Docker's official apt repo (skipped when `docker compose` already works)
#   c. `ubuntu` joins the docker group, docker service enabled
#   d. unattended-upgrades switched on
#   e. host firewall: tcp 80 / tcp 443 / udp 443 inserted before the REJECT rule in
#      /etc/iptables/rules.v4 and persisted (OCI Ubuntu images ship that file)
#   f. /opt/wallet_app/{,backups} owned by ubuntu
#
# NOTE: the OCI VCN Security List (cloud-side firewall) is NOT touched here; 80/443 must be
# opened there too, in the OCI console.

set -euo pipefail

APP_USER="${WALLET_VM_USER:-ubuntu}"
APP_DIR="${WALLET_REMOTE_DIR:-/opt/wallet_app}"
RULES_CHANGED=0

usage() {
  cat <<USAGE
Usage: ssh wallet-vm 'bash -s' < infra/scripts/vm-bootstrap.sh
       bash vm-bootstrap.sh [--help]

Initialises an Ubuntu 24.04 VM for the wallet stack: Docker CE + compose plugin, docker
group, unattended-upgrades, iptables 80/443 (persisted), and ${APP_DIR}.
Safe to run repeatedly. Needs passwordless sudo (default on OCI's ubuntu user).

Env: WALLET_VM_USER (default ubuntu), WALLET_REMOTE_DIR (default /opt/wallet_app)
USAGE
}

log() { printf '==> %s\n' "$*"; }

# Insert one ACCEPT rule at INPUT position $1 unless an identical rule already exists.
# The rule spec is the remaining arguments, so -C and -I see exactly the same text.
ensure_iptables_rule() {
  local pos="$1"; shift
  if sudo iptables -C INPUT "$@" 2>/dev/null; then
    log "iptables rule already present: $*"
  else
    sudo iptables -I INPUT "$pos" "$@"
    log "iptables rule inserted at INPUT position ${pos}: $*"
    RULES_CHANGED=1
  fi
}

step_packages() {
  log "apt update + dist-upgrade"
  sudo apt-get update
  sudo apt-get -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
    dist-upgrade
  sudo apt-get -y install ca-certificates curl gnupg rsync unattended-upgrades
}

step_docker() {
  if docker compose version >/dev/null 2>&1 || sudo docker compose version >/dev/null 2>&1; then
    log "Docker + compose plugin already installed; skipping install"
  else
    log "installing Docker CE from the official apt repository"
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    # Rewritten with identical content on every run, so re-runs are harmless.
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update
    sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # usermod -aG is a no-op when the user is already in the group.
  sudo usermod -aG docker "$APP_USER"
  sudo systemctl enable --now docker
}

step_unattended_upgrades() {
  log "enabling unattended-upgrades"
  # Same content on every run.
  printf '%s\n' \
    'APT::Periodic::Update-Package-Lists "1";' \
    'APT::Periodic::Unattended-Upgrade "1";' \
    | sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null
}

step_firewall() {
  if [ ! -f /etc/iptables/rules.v4 ]; then
    log "no /etc/iptables/rules.v4 on this host (not an OCI Ubuntu image?); skipping host firewall"
    return 0
  fi
  log "opening tcp 80, tcp 443, udp 443 in the host firewall"
  if ! command -v netfilter-persistent >/dev/null 2>&1; then
    sudo apt-get -y install netfilter-persistent iptables-persistent
  fi

  # Position of the existing "--dport 22 ... ACCEPT" rule among the INPUT rules (the -P line
  # is not a rule, so it is dropped before numbering). Insert right after it, i.e. before
  # the trailing REJECT. Fall back to "before the first REJECT", then to appending.
  local rules ssh_n reject_n pos
  rules="$(sudo iptables -S INPUT | grep -v '^-P ' || true)"
  ssh_n="$(printf '%s\n' "$rules" | grep -n -- '--dport 22 .*-j ACCEPT' | head -n1 | cut -d: -f1 || true)"
  reject_n="$(printf '%s\n' "$rules" | grep -n -- '-j REJECT' | head -n1 | cut -d: -f1 || true)"
  if [ -n "$ssh_n" ]; then
    pos=$((ssh_n + 1))
  elif [ -n "$reject_n" ]; then
    pos="$reject_n"
  else
    pos=$(( $(printf '%s\n' "$rules" | grep -c . || true) + 1 ))
  fi

  ensure_iptables_rule "$pos"       -p tcp -m state --state NEW -m tcp --dport 80  -j ACCEPT
  ensure_iptables_rule $((pos + 1)) -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
  ensure_iptables_rule $((pos + 2)) -p udp -m state --state NEW -m udp --dport 443 -j ACCEPT
  # Always save: harmless when nothing changed, and it repairs a rules.v4 that lags the live rules.
  sudo netfilter-persistent save
  log "host firewall done (rules changed this run: ${RULES_CHANGED})"
}

step_dirs() {
  log "preparing ${APP_DIR}"
  sudo mkdir -p "${APP_DIR}/backups"
  sudo chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

step_summary() {
  echo
  log "done"
  sudo docker --version
  sudo docker compose version
  if [ -f /var/run/reboot-required ]; then
    echo "NOTE: a reboot is pending (kernel/libc upgrade). Run 'sudo reboot' when convenient."
  fi
  cat <<MSG

Next steps:
  * Log out and back in (open a new ssh session) so the '${APP_USER}' docker group
    membership takes effect.
  * In the OCI console, add Ingress rules to the VCN Security List for tcp 80, tcp 443 and
    udp 443 (source 0.0.0.0/0). The host firewall is open now, the cloud firewall is not.
MSG
}

main() {
  case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    "") ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
  export DEBIAN_FRONTEND=noninteractive
  if [ "$(id -u)" -eq 0 ]; then
    echo "run this as the '${APP_USER}' user (it uses sudo itself), not as root" >&2
    exit 1
  fi
  sudo -n true 2>/dev/null || { echo "passwordless sudo is required" >&2; exit 1; }

  step_packages
  step_docker
  step_unattended_upgrades
  step_firewall
  step_dirs
  step_summary
}

# The call gets </dev/null on purpose: when this file is piped into `bash -s`, any command
# that reads stdin (apt, dpkg, ...) would otherwise swallow the rest of the script.
main "$@" </dev/null
