#!/bin/bash
# Source of truth for /home/deploys/bin/deploy. NOT run from the checkout -- copy it to the host after
# changing it (see docs/workflow.md). It lives on the host because it must be able to deploy a commit older
# than any change to itself, and keep working when a bad commit is what you are backing out of; this copy
# exists so those edits are reviewable and do not survive only in one box's filesystem.
set -euo pipefail

case "${SSH_ORIGINAL_COMMAND:-}" in
  main)   BRANCH=main;   REPO=/home/deploys/repos/prod ;;
  canary) BRANCH=canary; REPO=/home/deploys/repos/canary ;;
  *) echo "refusing to deploy unknown channel: ${SSH_ORIGINAL_COMMAND:-<empty>}" >&2; exit 1 ;;
esac

# Lock in the deploys home rather than /var/lock -- that directory's ownership and mode vary by
# distro, and this runs unprivileged.
exec 9>"/home/deploys/.deploy-${BRANCH}.lock"
flock -n 9 || { echo "a ${BRANCH} deploy is already running" >&2; exit 1; }

cd "$REPO"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

./compose pull

# Replaces the api's and each bot's containers one at a time
# `set -e` aborts the deploy if a replacement never becomes healthy, leaving every old container running.
./compose roll

# Converges everything `roll` does not touch -- postgres, redis, the proxy, ingress, monitoring -- and is a
# no-op for the services just rolled. Applies migrations via the `migrate` gate and blocks until healthy.
./compose up -d

docker image prune -f
