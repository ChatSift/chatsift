#!/bin/bash

docker-compose \
  -p automoderator \
  -f compose/docker-compose.yml \
  -f compose/docker-compose.services.yml \
  -f compose/docker-compose.$1.yml \
  -f compose/docker-compose.config.yml \
  -f compose/docker-compose.config.$1.yml \
  ${@%$1}
