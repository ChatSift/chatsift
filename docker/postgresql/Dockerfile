FROM postgres:12-alpine

LABEL name "automoderator postgresql"

COPY *.sql /docker-entrypoint-initdb.d/
