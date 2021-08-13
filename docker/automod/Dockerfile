FROM chatsift/automoderator_base
LABEL name "automoderator automod builder"

WORKDIR /opt/build

COPY services/automod/package.json ./services/automod/package.json

RUN wget -O ./services/automod/tlds.txt https://data.iana.org/TLD/tlds-alpha-by-domain.txt
RUN pnpm i --frozen-lockfile

COPY services/automod ./services/automod
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator automod"
LABEL version "0.1.0"

WORKDIR /usr/automod

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/automod/dist/index.js"]
