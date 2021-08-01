FROM nginx:latest
LABEL name "automoderator nginx"

COPY ./docker/nginx/*.conf /etc/nginx/
COPY ./docker/nginx/sites/*.conf /usr/sites/
