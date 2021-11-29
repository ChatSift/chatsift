FROM chatsift/automoderator_base
LABEL name "automoderator dash builder"

WORKDIR /opt/build

COPY services/dash/package.json ./services/dash/package.json
RUN pnpm i --frozen-lockfile
COPY services/dash ./services/dash
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator dash"
LABEL version "0.1.0"

WORKDIR /usr/dash

COPY --from=0 /opt/build ./

EXPOSE 4000

CMD ["pnpm", "run", "--dir", "services/dash", "start"]
