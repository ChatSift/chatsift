# Pinned to the same floating tag as the `postgres` service in docker-compose.yml, deliberately rather
# than to a version of its own: pg_dump refuses outright to dump a server newer than itself, so the
# dumper has to move whenever the server does. Pinning the two independently is exactly what stranded
# the service this replaces -- ChatSift/stack still runs kartoza/pg-backup:12.4, whose pg_dump cannot
# read a 17 cluster at all.
FROM postgres:17-alpine
LABEL org.opencontainers.image.title="chatsift pg-backup"

# alpine community, 0.18.x at the time of writing. Repository format v2 -- which is what gives the
# dumps compression on top of dedup, see --compress=0 in backup.sh -- has been restic's default since
# 0.14, so the exact patch version here is not load-bearing.
RUN apk add --no-cache restic

# Pre-created and chowned in the image so the named volume Docker initializes from this path inherits
# the ownership, which is what lets the container drop to `postgres` below. A volume created against a
# root-owned mountpoint would be unwritable to it.
RUN mkdir -p /var/lib/pg-backup && chown postgres:postgres /var/lib/pg-backup

COPY ./backup.sh /usr/local/bin/backup.sh
RUN chmod 0755 /usr/local/bin/backup.sh

# Nothing here needs root: it reaches Postgres over TCP and writes only to the volume above.
USER postgres

ENTRYPOINT ["/usr/local/bin/backup.sh"]
