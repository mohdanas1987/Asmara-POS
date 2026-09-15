#!/bin/sh
set -e

# Phase 1 / Docker dev setup: this container never touches srv1399.hstgr.io -- it only
# knows how to run server.local.js against a local SQLite file (knexfile.local.js).

if [ ! -f .env.local ]; then
    echo "No .env.local found -- generating one with a fresh dev-only JWT secret..."
    SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
    cat > .env.local <<EOF
JWT_SECRET=${SECRET}
ALLOWED_ORIGINS=
DFTECH_FALLBACK_TOKEN=local-dev-not-real
EOF
fi

# .seeded is a marker file (not the database itself -- migrate:latest below creates
# local_test.sqlite as a side effect even on a totally fresh run, so checking for the
# database file's existence wouldn't distinguish "brand new" from "just migrated").
if [ ! -f .seeded ]; then
    FIRST_RUN=true
else
    FIRST_RUN=false
fi

echo "Running migrations (migrations_local/, safe to re-run) ..."
node_modules/.bin/knex migrate:latest --knexfile knexfile.local.js

if [ "$FIRST_RUN" = "true" ]; then
    echo "First run -- seeding local_test.sqlite with test data."
    echo "(login: admin@test.local / Test1234! once the server is up)"
    node_modules/.bin/knex seed:run --knexfile knexfile.local.js
    touch .seeded
else
    echo "Already seeded on a previous run -- leaving your data as-is."
    echo "To reset: stop the container, delete backend/local_test.sqlite AND backend/.seeded on your Mac, then restart."
fi

echo ""
echo "Starting local dev server on http://localhost:5102 (auto-restarts on file changes) ..."
exec node_modules/.bin/nodemon --watch . --ignore test/ --ignore '*.sqlite' server.local.js
