#!/usr/bin/env bash
# Container smoke, shared by the local verify and CI (ubuntu-24.04 and ubuntu-24.04-arm).
#
# Builds the image, starts migrate and web, proves the waiting state, then starts the worker behind a real
# CONNECT proxy on an internal Docker network and proves the fill path and the operator commands. It runs
# as project havadis-smoke on port ${HAVADIS_PORT:-4100} with its own env file, so it never touches a
# running instance's containers or volume; it does write to ./backups and rebuilds the havadis:local tag.
# Third-party hosts are never contacted: the worker's only route out is the sandbox proxy, which can
# reach one fixture that impersonates www.bleepingcomputer.com with a throwaway certificate.
#
# Every assertion prints one PASS line or one FAIL line and exits non-zero. The Linux-only steps
# (chown of ./backups, the unwritable /backups check) print SKIP elsewhere: Docker Desktop bind mounts
# ignore ownership, so the case cannot be reproduced there.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT=havadis-smoke
ENV_FILE=.env.smoke
export HAVADIS_ENV_FILE="$ENV_FILE"
export HAVADIS_PORT="${HAVADIS_PORT:-4100}"
unset HAVADIS_BIND
IS_LINUX=false
[ "$(uname -s)" = "Linux" ] && IS_LINUX=true

STACK_STARTED=false
SANDBOX_DIR=""
PROBE_DIR=""
BACKUPS_EXISTED=false
BACKUPS_BEFORE=""

pass() { echo "PASS $*"; }
skip() { echo "SKIP $*"; }

dc() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f compose.yaml -f scripts/smoke/compose.smoke.yaml "$@"
}

fail() {
  echo "FAIL $*"
  if $STACK_STARTED; then
    echo "--- compose ps" >&2
    dc ps -a >&2 || true
    echo "--- compose logs (last 40 lines per service)" >&2
    dc logs --no-color --tail 40 >&2 || true
  fi
  exit 1
}

# rm that falls back to sudo on Linux, where uid 65532 may own what the containers created.
remove_path() {
  rm -rf -- "$1" 2>/dev/null && return 0
  if $IS_LINUX; then sudo -n rm -rf -- "$1" 2>/dev/null || true; fi
  return 0
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [ -f "$ENV_FILE" ] && [ -n "$SANDBOX_DIR" ]; then
    dc down -v --remove-orphans >/dev/null 2>&1
  fi
  if [ -d backups ]; then
    local entry name
    for entry in backups/* backups/.[!.]*; do
      [ -e "$entry" ] || continue
      name=${entry#backups/}
      if ! printf '%s\n' "$BACKUPS_BEFORE" | grep -qxF -- "$name"; then remove_path "$entry"; fi
    done
    if ! $BACKUPS_EXISTED; then rmdir backups 2>/dev/null || { $IS_LINUX && sudo -n rmdir backups 2>/dev/null; }; fi
  fi
  [ -n "$PROBE_DIR" ] && remove_path "$PROBE_DIR"
  [ -n "$SANDBOX_DIR" ] && remove_path "$SANDBOX_DIR"
  rm -f "$ENV_FILE"
  exit "$status"
}

# Polls a command until it succeeds or the time is up.
wait_for() {
  local seconds=$1 what=$2
  shift 2
  local deadline=$((SECONDS + seconds))
  until "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || fail "timed out after ${seconds}s waiting for $what"
    sleep 2
  done
}

health() { curl -fsS --max-time 5 "http://127.0.0.1:${HAVADIS_PORT}/api/health"; }
health_is() { [ "$(health)" = "$1" ]; }
page() { curl -fsS --max-time 10 "http://127.0.0.1:${HAVADIS_PORT}/"; }
page_has_fixture() {
  local body
  body=$(page) || return 1
  [[ $body == *"Havadis smoke fixture story"* && $body != *"Waiting for the first ingestion"* ]]
}

# ---------------------------------------------------------------- preflight
docker info >/dev/null 2>&1 || { echo "FAIL preflight: Docker Engine is not running (docker info failed)"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "FAIL preflight: Docker Compose v2 is missing (docker compose version failed)"; exit 1; }
openssl version >/dev/null 2>&1 || { echo "FAIL preflight: openssl is not on PATH"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FAIL preflight: curl is not on PATH"; exit 1; }
if $IS_LINUX; then
  sudo -n true >/dev/null 2>&1 || { echo "FAIL preflight: passwordless sudo is required on Linux (sudo -n true failed)"; exit 1; }
fi
pass "preflight: docker, compose, openssl and curl are available"

grep -q 'url: "https://www.bleepingcomputer.com/feed/"' src/lib/config/sources.ts \
  || { echo "FAIL https://www.bleepingcomputer.com/feed/ is no longer a curated source in src/lib/config/sources.ts; the fixture impersonates it"; exit 1; }
pass "the fixture host is still a curated source"

# ---------------------------------------------------------------- setup
if [ -d backups ]; then
  BACKUPS_EXISTED=true
  BACKUPS_BEFORE=$(ls -1A backups)
fi
SANDBOX_DIR=$(mktemp -d)
trap cleanup EXIT
chmod 755 "$SANDBOX_DIR"
export HAVADIS_SMOKE_SANDBOX="$SANDBOX_DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$SANDBOX_DIR/key.pem" -out "$SANDBOX_DIR/cert.pem" \
  -subj "/CN=www.bleepingcomputer.com" \
  -addext "subjectAltName=DNS:www.bleepingcomputer.com" >/dev/null 2>&1
chmod 644 "$SANDBOX_DIR/key.pem" "$SANDBOX_DIR/cert.pem"

mkdir -p backups
if $IS_LINUX; then
  sudo -n chown 65532:65532 backups
  pass "backups is owned by uid 65532 (Linux host)"
else
  skip "chown of ./backups to 65532: Docker Desktop bind mounts ignore ownership on this host"
fi

SMOKE_KEY=$(openssl rand -base64 32)
umask 077
printf 'HAVADIS_SECRET_KEY=%s\n' "$SMOKE_KEY" >"$ENV_FILE"
umask 022

# ---------------------------------------------------------------- phase A: waiting state
STACK_STARTED=true
dc up -d --build web
wait_for 180 "web to answer /api/health" health
pass "migrate completed and web answers /api/health"

[ "$(health)" = '{"status":"degraded","web":"ok","worker":"waiting","schema":"ok"}' ] \
  || fail "waiting-state health body is not exactly the four keys with schema ok and worker waiting: $(health)"
pass "/api/health has exactly status, web, worker, schema with schema ok and worker waiting"

headers=$(curl -sS --max-time 10 -D - -o /dev/null "http://127.0.0.1:${HAVADIS_PORT}/")
body=$(page)
[[ $body == *"Waiting for the first ingestion"* ]] || fail "GET / does not say it is waiting for the first ingestion"
printf '%s\n' "$headers" | grep -qi '^content-security-policy:' || fail "GET / carries no Content-Security-Policy header"
pass "GET / shows the waiting text and a Content-Security-Policy header"

bound=$(dc port web 4000)
case "$bound" in
  127.0.0.1:*) pass "web port is published on loopback only ($bound)" ;;
  *) fail "web port is not published on 127.0.0.1: $bound" ;;
esac

web_identity=$(dc exec -T web /nodejs/bin/node -e 'process.stdout.write(process.getuid() + " " + process.env.NEXT_TELEMETRY_DISABLED)')
[ "$web_identity" = "65532 1" ] || fail "web runs as '$web_identity', expected uid 65532 and NEXT_TELEMETRY_DISABLED 1"
pass "web runs as uid 65532 with NEXT_TELEMETRY_DISABLED=1"

# ---------------------------------------------------------------- phase B: fill path through the proxy
dc up -d worker
wait_for 90 "the worker heartbeat to report ok" health_is '{"status":"ok","web":"ok","worker":"ok","schema":"ok"}'
pass "/api/health reports the worker ok"

wait_for 180 "the front page to show the fixture stories" page_has_fixture
pass "GET / shows the fixture feed's stories and no longer the waiting text"

# Logs are captured first: grep -q closing a pipe early would fail the pipeline under pipefail.
proxy_log=$(dc logs --no-color proxy)
[[ $proxy_log == *"CONNECT www.bleepingcomputer.com:443"* ]] || fail "the proxy log has no CONNECT www.bleepingcomputer.com:443"
pass "the proxy log shows CONNECT www.bleepingcomputer.com:443"

worker_identity=$(dc exec -T worker /nodejs/bin/node -e 'process.stdout.write(String(process.getuid()))')
[ "$worker_identity" = "65532" ] || fail "worker runs as uid '$worker_identity', expected 65532"
pass "worker runs as uid 65532"

worker_log=$(dc logs --no-color --no-log-prefix worker)
[ -n "$worker_log" ] || fail "the worker wrote no log lines, so the URL check would prove nothing"
[[ $worker_log != *"://"* ]] || fail "a worker log line contains '://'"
pass "no worker log line contains a URL"

# ---------------------------------------------------------------- phase C: operator commands
selftest=$(dc exec -T worker havadis selftest)
[[ $selftest == *fts5* ]] || fail "havadis selftest did not print fts5: $selftest"
pass "havadis selftest prints fts5 inside the image"

backup_out=$(dc exec -T worker havadis backup) || fail "havadis backup exited non-zero"
compgen -G "backups/havadis-*-manual.db" >/dev/null || fail "havadis backup wrote no .db file into ./backups (it printed: $backup_out)"
pass "havadis backup wrote a .db file into ./backups"

rc=0
key_out=$(dc run --rm -T -e HAVADIS_SECRET_KEY= migrate havadis migrate 2>&1) || rc=$?
[ "$rc" -eq 1 ] || fail "migrate without a key exited $rc, expected 1"
[[ $key_out == *HAVADIS_SECRET_KEY* ]] || fail "the key refusal does not name HAVADIS_SECRET_KEY: $key_out"
pass "migrate refuses a missing key with exit 1 and names HAVADIS_SECRET_KEY"

if $IS_LINUX; then
  PROBE_DIR=$(mktemp -d)
  sudo -n chown root:root "$PROBE_DIR"
  sudo -n chmod 755 "$PROBE_DIR"
  rc=0
  probe_out=$(docker run --rm --user 65532:65532 --read-only --entrypoint /usr/local/bin/havadis \
    -e HAVADIS_SECRET_KEY="$SMOKE_KEY" --mount type=volume,dst=/data -v "$PROBE_DIR:/backups" \
    havadis:local migrate 2>&1) || rc=$?
  [ "$rc" -eq 1 ] || fail "migrate against a root-owned /backups exited $rc, expected 1"
  [[ $probe_out == *"sudo chown 65532:65532 backups"* ]] || fail "the unwritable-backups refusal has no chown hint: $probe_out"
  pass "migrate against a root-owned /backups exits 1 with the chown hint"
else
  skip "unwritable /backups check: Docker Desktop bind mounts ignore ownership on this host"
fi
