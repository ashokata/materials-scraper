#!/bin/sh
set -e

echo "Syncing database schema..."
npx prisma db push --skip-generate

echo "Starting application..."
exec node dist/main
