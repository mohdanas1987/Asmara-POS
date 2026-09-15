# Asmara POS backend -- local/offline dev & test container.
#
# Runs the SAME route/model code the real app uses (backend/server.local.js imports the
# real routes/*.js files unmodified), wired to a local SQLite database instead of the real
# production MySQL on srv1399.hstgr.io. Nothing here ever talks to that host -- there is no
# network configuration for it anywhere in this setup. Good for testing the Phase 1 changes
# (auth fixes, table-transfer, multi-tenant scoping, etc.) from a Mac without needing Windows
# or touching the live database.
FROM node:20-bookworm-slim

# Some dependencies (bcrypt, sqlite3) may need to compile a native addon if no prebuilt
# binary matches this image's exact platform/Node version -- these are what node-gyp needs
# to do that. Using a glibc-based image (not Alpine) specifically because prebuilt native
# binaries for these packages are generally built against glibc, not musl.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installed separately from the rest of the source so this layer is cached across rebuilds
# unless package.json itself changes.
COPY backend/package.json ./package.json
RUN npm install

COPY backend/ ./

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5102

ENTRYPOINT ["docker-entrypoint.sh"]
