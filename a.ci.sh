#!/bin/bash

docker-compose \
  -p automoderator \
  -f compose/docker-compose.services.yml \
  ${@%$0}
