FROM automoderator:base
LABEL name "automoderator cron-runner builder"

WORKDIR /opt/build

COPY services/cron-runner/package.json ./services/cron-runner/package.json
RUN pnpm i --frozen-lockfile
COPY services/cron-runner ./services/cron-runner
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator cron-runner"
LABEL version "0.1.0"

WORKDIR /usr/cron-runner

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/cron-runner/dist/index.js"]
