#!/bin/sh
set -eu

# Render the upstream into the nginx config before starting.
envsubst '${API_UPSTREAM} ${AUTH_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
