# Multi-stage on purpose. Docker layers are additive, so in the previous single-stage build the
# `yarn workspaces focus --all --production` prune at the end deleted the dev dependencies from the
# filesystem but every one of them still shipped in the earlier layer -- as did the alpine-sdk/python3
# build toolchain, which was installed as a virtual package and then never `apk del`'d. Copying the
# finished tree into a clean stage is what actually drops them.
#
# That size is now paid on every pull by two deployments (prod and canary) rather than one, which is
# what moved this from nice-to-have to worth doing.
FROM node:24-alpine AS builder
LABEL name="chatsift"

WORKDIR /usr/chatsift

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

COPY turbo.json package.json tsconfig.base.json tsconfig.json tsup.config.ts yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Every workspace's manifest, and nothing else, so that the install layer below is cached against the
# dependency graph rather than against the source. `apps/website` is deliberately absent throughout --
# the frontend deploys out-of-band on Vercel.
COPY packages/public/discord-utils/package.json ./packages/public/discord-utils/package.json
COPY packages/public/parse-relative-time/package.json ./packages/public/parse-relative-time/package.json
COPY packages/public/pino-rotate-file/package.json ./packages/public/pino-rotate-file/package.json
COPY packages/private/backend-core/package.json ./packages/private/backend-core/package.json
COPY packages/private/bot-core/package.json ./packages/private/bot-core/package.json
COPY packages/private/core/package.json ./packages/private/core/package.json
COPY packages/private/db/package.json ./packages/private/db/package.json

COPY services/ama-bot/package.json ./services/ama-bot/package.json
COPY services/automoderator-bot/package.json ./services/automoderator-bot/package.json
COPY services/api/package.json ./services/api/package.json
COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
COPY services/modmail-bot/package.json ./services/modmail-bot/package.json
COPY services/social-bot/package.json ./services/social-bot/package.json

RUN yarn workspaces focus --all

# Source. `.dockerignore` keeps node_modules/dist/.next out, so these merge over the manifests above
# without clobbering the installed tree.
COPY packages ./packages
COPY services ./services

RUN yarn turbo run build
RUN yarn workspaces focus --all --production

# The shipped image: no build toolchain, no dev dependencies, no yarn release bundle.
FROM node:24-alpine
LABEL name="chatsift"

WORKDIR /usr/chatsift

RUN apk add --no-cache ca-certificates

COPY --from=builder /usr/chatsift/package.json ./package.json
COPY --from=builder /usr/chatsift/node_modules ./node_modules
# `src/` rides along on purpose: the services run with `--enable-source-maps`, and the emitted maps
# point back at the TypeScript sources, so dropping them would turn every production stack trace back
# into compiled-output line numbers.
COPY --from=builder /usr/chatsift/packages ./packages
COPY --from=builder /usr/chatsift/services ./services

# No CMD -- docker-compose.yml supplies the per-service command. `packages/private/db/dist/scripts/*`
# is present in this image on purpose: the one-off data migrations are run inside the live `api`
# container (see docs/roadmap/11-automoderator-port.md), as bare `node .../dist/scripts/X.js` rather
# than the root `yarn migrate:*` wrappers, which need the `dotenv-cli` dev dependency that is pruned
# above. Compose already injects the environment those scripts read.
