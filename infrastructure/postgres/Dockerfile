FROM node:24-bookworm-slim AS node
FROM postgres:16-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENTRYPOINT ["/bin/sh"]
