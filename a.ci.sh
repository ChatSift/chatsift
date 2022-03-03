#!/bin/bash

docker-compose \
  -p automoderator-v2 \
  -f compose/docker-compose.services.yml \
  ${@%$0}
