# Static hosting for the TurniRUM web app (the backend lives in Supabase).
FROM caddy:2.10-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/index.html
COPY css /srv/css
COPY img /srv/img
COPY js /srv/js
COPY vendor /srv/vendor
