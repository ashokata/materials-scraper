#!/bin/bash
# Deployment script for Materials Scraper API on Hostinger VPS

set -e

# Configuration
REPO_URL="https://github.com/infield-works/materials-scraper.git"
DEPLOY_DIR="/opt/materials-scraper"
BRANCH="${1:-main}"

echo "=== Materials Scraper Deployment ==="
echo "Branch: $BRANCH"
echo "Directory: $DEPLOY_DIR"
echo ""

# Check if directory exists
if [ -d "$DEPLOY_DIR" ]; then
    echo "Updating existing deployment..."
    cd "$DEPLOY_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    echo "Fresh deployment..."
    git clone -b "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
    cd "$DEPLOY_DIR"
fi

# Create .env.production if it doesn't exist
if [ ! -f ".env.production" ]; then
    echo "Creating .env.production..."
    cat > .env.production << EOF
# Authentication
AUTH_USERNAME=admin
AUTH_PASSWORD=CHANGE_ME_SECURE_PASSWORD

# Database
DATABASE_URL=postgresql://scraper:\${DB_PASSWORD}@postgres:5432/materials

# Server
PORT=3000
CACHE_TTL=3600
EOF
    echo "WARNING: Please edit .env.production with secure credentials!"
fi

# Ensure Traefik network exists
docker network create traefik_network 2>/dev/null || true

# Build and deploy
echo "Building and deploying..."
docker-compose down --remove-orphans || true
docker-compose build --no-cache
docker-compose up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 10

# Run migrations
echo "Running database migrations..."
docker-compose exec -T scraper-api npx prisma migrate deploy

# Check status
echo ""
echo "=== Deployment Complete ==="
docker-compose ps

echo ""
echo "API should be available at: https://materials.infieldr.io"
echo "Health check: curl https://materials.infieldr.io/api/health"
