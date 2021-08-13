FROM chatsift:automoderator_base
LABEL name "automoderator auth builder"

WORKDIR /opt/build

COPY services/auth/package.json ./services/auth/package.json
RUN pnpm i --frozen-lockfile
COPY services/auth ./services/auth
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator auth"
LABEL version "0.1.0"

WORKDIR /usr/auth

COPY --from=0 /opt/build ./

EXPOSE 3000

CMD ["node", "--enable-source-maps", "services/auth/dist/index.js"]
