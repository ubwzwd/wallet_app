#!/usr/bin/env bash
# infra/scripts/vm-bootstrap.sh -- one-time (re-runnable) initialisation of the deploy VM.
#
# Target: Ubuntu 24.04 (22.04 works too), amd64 or arm64, login user `ubuntu` with passwordless
# sudo. Written for AWS Lightsail; also fine on OCI and other VPS images of the same shape.
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
#      /etc/iptables/rules.v4 and persisted. Only OCI Ubuntu images ship that file; on
#      Lightsail and most other providers the host has no such rules and the step is skipped
#   f. a 2 GB swap file when the machine has less than 2 GB of RAM and no swap yet
#   g. /opt/wallet_app/{,backups} owned by ubuntu
#
# NOTE: the provider's cloud-side firewall (Lightsail instance firewall, OCI Security List, ...)
# is NOT touched here; tcp 80, tcp 443 and udp 443 must be opened there too, in its console.

set -euo pipefail

APP_USER="${WALLET_VM_USER:-ubuntu}"
APP_DIR="${WALLET_REMOTE_DIR:-/opt/wallet_app}"
RULES_CHANGED=0

usage() {
  cat <<USAGE
Usage: ssh wallet-vm 'bash -s' < infra/scripts/vm-bootstrap.sh
       bash vm-bootstrap.sh [--help]

Initialises an Ubuntu 24.04 VM for the wallet stack: Docker CE + compose plugin, docker
group, unattended-upgrades, iptables 80/443 where the image ships rules, a swap file on
small machines, and ${APP_DIR}.
Safe to run repeatedly. Needs passwordless sudo (default for the ubuntu user on Lightsail / OCI).

Env: WALLET_VM_USER (default ubuntu), WALLET_REMOTE_DIR (default /opt/wallet_app)
USAGE
}

# sudo's env_reset drops DEBIAN_FRONTEND, so pass it (and needrestart's non-interactive mode)
# on the sudo command line for every apt-get call.
apt_get() { sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get "$@"; }

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
  apt_get update
  apt_get -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
    dist-upgrade
  # cron is not guaranteed on Minimal images; deploy.sh schedules the nightly backup with it.
  apt_get -y install ca-certificates curl gnupg rsync cron unattended-upgrades
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
    apt_get update
    apt_get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
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
    log "no /etc/iptables/rules.v4 on this host (normal outside OCI); nothing to open in the host firewall"
    return 0
  fi
  log "opening tcp 80, tcp 443, udp 443 in the host firewall"
  if ! command -v netfilter-persistent >/dev/null 2>&1; then
    apt_get -y install netfilter-persistent iptables-persistent
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
  # Save when this run changed something, or when a previous run inserted the live rules
  # but never saved them. step_firewall runs before Docker is installed, so the first save
  # does not capture Docker's own chains; a save on a later re-run does include them, which
  # is harmless (they are restored at boot and then rewritten by dockerd).
  if [ "$RULES_CHANGED" -eq 1 ] || ! sudo grep -q -- '--dport 443' /etc/iptables/rules.v4; then
    sudo netfilter-persistent save
  fi
  log "host firewall done (rules changed this run: ${RULES_CHANGED})"
}

# Small VMs (1 GB) run the stack fine at rest, but an image build or a pg_restore next to the
# running stack can push them into the OOM killer. A swap file makes those peaks survivable.
step_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
  if [ "$mem_kb" -ge 1900000 ]; then
    log "RAM is $((mem_kb / 1024)) MB; no swap file needed"
    return 0
  fi
  if [ "$swap_kb" -gt 0 ]; then
    log "swap already active ($((swap_kb / 1024)) MB); leaving it alone"
  elif [ -e /swapfile ]; then
    log "/swapfile exists but is not active; enabling it"
    sudo swapon /swapfile
  else
    log "RAM is $((mem_kb / 1024)) MB; creating a 2 GB swap file"
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
  fi
  if [ -e /swapfile ] && ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  # Prefer RAM; swap is for peaks only. Same content on every run.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-wallet-swap.conf >/dev/null
  sudo sysctl -q -p /etc/sysctl.d/99-wallet-swap.conf
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
  * In the provider's console, open tcp 80, tcp 443 and udp 443 to 0.0.0.0/0 in the
    cloud-side firewall (Lightsail: instance -> Networking -> IPv4 Firewall; OCI: the VCN
    Security List). This script does not touch it.
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
  step_firewall
  step_docker
  step_unattended_upgrades
  step_swap
  step_dirs
  step_summary
}

# The call gets </dev/null on purpose: when this file is piped into `bash -s`, any command
# that reads stdin (apt, dpkg, ...) would otherwise swallow the rest of the script.
main "$@" </dev/null
