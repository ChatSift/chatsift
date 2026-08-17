FROM caddy:2.11.4-builder-alpine AS builder

RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.11.4-alpine
LABEL org.opencontainers.image.title="chatsift ingress"

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY ./Caddyfile /etc/caddy/Caddyfile
