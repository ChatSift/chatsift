#!/bin/sh
# Nightly logical backup of the entire Postgres cluster into a restic repository on S3.
#
# Replaces the `pg-backup` service in ChatSift/stack, which was silently keeping every backup ever
# taken. That image's REMOVE_BEFORE is a `find ${MYBASEDIR}/* -mmin +N -delete` over the container's
# own scratch directory, so with STORAGE_BACKEND=S3 the bucket was never pruned and 30-day retention
# was a manual chore against the console. Upstream grew a real `run_s3_retention` long after the
# version pinned there.
#
# restic rather than dumps-as-objects plus a hand-written pruner: `forget --keep-daily` is tested
# upstream code that will not empty a repository, the dumps dedup and compress across days (see
# --compress=0 below), and `check` verifies the backups without needing a restore.
#
# Everything that fails writes to stderr, which is what the Dozzle relay watches -- there is no
# Prometheus metric behind this. Note the gap that leaves: a container that never starts at all
# produces no stderr either. `docker compose ps` and the `last-success` marker below are what answer
# that, and the restore drill in docs/workflow.md is what proves the backups are real.
set -eu

STATE_DIR='/var/lib/pg-backup'
WORK_DIR="${STATE_DIR}/work"
LAST_SUCCESS_FILE="${STATE_DIR}/last-success"

# The snapshot's restic "host", and with --group-by below the only thing that decides which snapshots
# compete for the retention budget. It is a fixed literal and NOT derived from COMPOSE_PROJECT_NAME or
# the container hostname on purpose: restic's default host is the hostname, which docker regenerates on
# every `up`, so each nightly snapshot would land in a group of its own and `--keep-daily 30` would
# faithfully keep the newest 1 of each -- i.e. all of them, forever. That is the same failure this
# service exists to fix, arrived at from the other direction. Changing this value strands every
# existing snapshot in an unpruned group; see docs/workflow.md before you do.
SNAPSHOT_HOST="${BACKUP_SNAPSHOT_HOST:-chatsift}"
SNAPSHOT_TAG="${BACKUP_SNAPSHOT_TAG:-chatsift-cluster}"

KEEP_DAILY="${BACKUP_KEEP_DAILY:-30}"
# A floor under the age-based policy, so a wrong clock or a bad KEEP_DAILY can never leave the
# repository empty. Cheap insurance on the one thing in the stack with no second copy.
KEEP_LAST="${BACKUP_KEEP_LAST:-3}"

SCHEDULE_HOUR_UTC="${BACKUP_SCHEDULE_HOUR_UTC:-3}"
MAX_ATTEMPTS="${BACKUP_MAX_ATTEMPTS:-3}"
RETRY_DELAY_SECONDS="${BACKUP_RETRY_DELAY_SECONDS:-600}"

now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s pg-backup: %s\n' "$(now)" "$*"; }
# Everything the operator is meant to see goes here, on stderr.
fail() { printf '%s pg-backup: FAILED: %s\n' "$(now)" "$*" >&2; }

for required in RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY PGHOST PGUSER PGPASSWORD
do
	eval "value=\${${required}:-}"
	if [ -z "$value" ]
	then
		fail "${required} is unset -- refusing to start. See .env.private.example."
		exit 1
	fi
done

# Stripped of a leading zero before it ever reaches $(( )), which would otherwise read it as octal --
# and 08/09 are not octal at all, so the container would die on those two hours only.
while [ "${#SCHEDULE_HOUR_UTC}" -gt 1 ]
do
	case "$SCHEDULE_HOUR_UTC" in
		0*) SCHEDULE_HOUR_UTC="${SCHEDULE_HOUR_UTC#0}" ;;
		*) break ;;
	esac
done

case "$SCHEDULE_HOUR_UTC" in
	'' | *[!0-9]*)
		fail "BACKUP_SCHEDULE_HOUR_UTC must be an integer hour 0-23, got: ${SCHEDULE_HOUR_UTC}"
		exit 1
		;;
esac
if [ "$SCHEDULE_HOUR_UTC" -gt 23 ]
then
	fail "BACKUP_SCHEDULE_HOUR_UTC must be an integer hour 0-23, got: ${SCHEDULE_HOUR_UTC}"
	exit 1
fi

# `set -e` does not apply inside a function whose result is being tested (`if run_backup`), so every
# step below carries its own `|| return 1` rather than relying on it. Without that, a failed pg_dump
# would fall through to the restic call and store whatever happened to be on disk.
run_backup() {
	rm -rf "$WORK_DIR" || return 1
	mkdir -p "$WORK_DIR" || return 1

	# Roles (including their password hashes), tablespaces and grants. Restoring these first is what
	# makes the per-database dumps below restorable at all -- every object in them is owned by a role
	# that has to exist already.
	log 'dumping globals'
	if ! pg_dumpall --globals-only --file="${WORK_DIR}/globals.sql"
	then
		fail 'pg_dumpall --globals-only failed'
		return 1
	fi
	if [ ! -s "${WORK_DIR}/globals.sql" ]
	then
		fail 'pg_dumpall --globals-only produced an empty file'
		return 1
	fi

	# Discovered rather than listed in config, so a database added later (glitchtip was, #386) cannot
	# be silently left out of the backups until someone notices.
	databases="$(psql --no-psqlrc --no-align --tuples-only --quiet --dbname=postgres \
		--command='SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname')" || {
		fail 'could not enumerate databases'
		return 1
	}
	if [ -z "$databases" ]
	then
		fail 'the cluster reported no connectable databases -- refusing to store an empty backup'
		return 1
	fi

	for database in $databases
	do
		log "dumping ${database}"
		# --compress=0 is the interesting flag. pg_dump's custom format compresses per-object by
		# default, and compressed output changes wholesale for a small input change, so restic would
		# dedup almost nothing and 30 dailies would cost 30 full dumps. Handing restic the raw bytes
		# lets it dedup across days and apply its own (repo-v2) compression on what is left.
		if ! pg_dump --format=custom --compress=0 --file="${WORK_DIR}/${database}.dump" "$database"
		then
			fail "pg_dump of ${database} failed"
			return 1
		fi

		# Reads the archive's table of contents, which is at the end of the file -- so a dump truncated
		# by a disk filling up or a connection dropping fails here, before it can be stored and mistaken
		# for a good backup.
		if ! pg_restore --list "${WORK_DIR}/${database}.dump" > /dev/null
		then
			fail "the dump of ${database} is not a readable archive -- not storing it"
			return 1
		fi
	done

	# Removes locks whose owning process is gone. Without it, one container killed mid-run (a deploy, an
	# OOM) would block every subsequent night with "repository is already locked". Only ever safe
	# because exactly one process writes to this repository; it does not touch live locks.
	restic unlock || true

	log 'storing snapshot'
	if ! restic backup --host "$SNAPSHOT_HOST" --tag "$SNAPSHOT_TAG" "$WORK_DIR"
	then
		fail 'restic backup failed'
		return 1
	fi

	# --group-by host (not restic's default host,paths) so that moving the work directory some day
	# re-uses the same retention group instead of quietly starting a second, unpruned one.
	log "pruning to --keep-daily ${KEEP_DAILY} --keep-last ${KEEP_LAST}"
	if ! restic forget --host "$SNAPSHOT_HOST" --tag "$SNAPSHOT_TAG" --group-by host \
		--keep-daily "$KEEP_DAILY" --keep-last "$KEEP_LAST" --prune
	then
		fail 'restic forget/prune failed -- the snapshot was stored, but old ones were not removed'
		return 1
	fi

	# Structural check only (metadata and pack indexes), which costs no egress. It catches the corrupt
	# repository that would otherwise be found on the day it is needed. Reading the data back is
	# `restic check --read-data`, run by hand as part of the restore drill in docs/workflow.md.
	if ! restic check
	then
		fail 'restic check reported a problem with the repository'
		return 1
	fi

	rm -rf "$WORK_DIR" || return 1
	date -u '+%s' > "$LAST_SUCCESS_FILE" || return 1

	return 0
}

backup_with_retries() {
	attempt=1
	while :
	do
		if run_backup
		then
			log 'backup complete'
			return 0
		fi

		# A run that died partway through has left however many dumps it got to on the volume. The next
		# run would clear them, but that is up to 24h of a multi-gigabyte partial sitting on a host that
		# alerts at 10% free disk.
		rm -rf "$WORK_DIR"

		if [ "$attempt" -ge "$MAX_ATTEMPTS" ]
		then
			fail "giving up after ${attempt} attempt(s); next scheduled run is tomorrow at ${SCHEDULE_HOUR_UTC}:00 UTC"
			return 1
		fi

		fail "attempt ${attempt} of ${MAX_ATTEMPTS} failed; retrying in ${RETRY_DELAY_SECONDS}s"
		attempt=$((attempt + 1))
		sleep "$RETRY_DELAY_SECONDS"
	done
}

seconds_until_next_run() {
	current="$(date -u '+%s')"
	# The epoch is aligned to midnight UTC, so this needs no date parsing (and dodges busybox's
	# `date -d`, plus `$(( ))` reading a zero-padded hour as octal).
	target=$((current - (current % 86400) + SCHEDULE_HOUR_UTC * 3600))
	[ "$target" -le "$current" ] && target=$((target + 86400))
	printf '%s' "$((target - current))"
}

# `restic init` against an existing repository is an error, not a no-op, so ask first. A wrong
# password or bad credentials surface here as a failed init rather than silently on the first night.
if ! restic cat config > /dev/null 2>&1
then
	log 'no repository at RESTIC_REPOSITORY yet, initializing'
	if ! restic init
	then
		fail 'could not open or create the repository -- check BACKUP_RESTIC_PASSWORD and the S3 credentials'
		exit 1
	fi
fi

# Catch up on startup rather than waiting for the window, so a first deploy (or a container that was
# down for days) is not left without a backup for up to 24 hours. A redeploy inside the normal daily
# cadence is a no-op.
catch_up=1
if [ -f "$LAST_SUCCESS_FILE" ]
then
	last_success="$(cat "$LAST_SUCCESS_FILE" 2> /dev/null || printf '0')"
	case "$last_success" in
		'' | *[!0-9]*) last_success=0 ;;
	esac
	if [ "$(( $(date -u '+%s') - last_success ))" -lt 86400 ]
	then
		catch_up=0
	fi
fi

if [ "$catch_up" -eq 1 ]
then
	log 'no successful backup in the last 24h, running one now'
	backup_with_retries || true
fi

log "scheduled for ${SCHEDULE_HOUR_UTC}:00 UTC daily"
while :
do
	sleep "$(seconds_until_next_run)"
	backup_with_retries || true
done
