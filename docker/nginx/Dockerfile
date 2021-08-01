FROM nginx:latest
LABEL name "automoderator nginx"

COPY ./docker/services/nginx/*.conf /etc/nginx/
COPY ./docker/services/nginx/sites/*.conf /usr/sites/
