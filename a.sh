#!/bin/bash

[ $2 == build ] && docker build -t automoderator:base -f ./docker/base/Dockerfile .
docker-compose -f docker-compose.yml -f docker-compose.$1.yml -f docker-compose.config.yml ${@%$1}
