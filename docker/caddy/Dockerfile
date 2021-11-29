FROM caddy:builder AS builder

RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:latest
LABEL name "automoderator caddy"

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY ./docker/caddy/Caddyfile /etc/caddy
