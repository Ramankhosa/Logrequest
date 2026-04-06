#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/logrequest}"
BRANCH="${BRANCH:-master}"
PM2_NAME="${PM2_NAME:-daswand}"
STASH_NAME="pre-deploy-${PM2_NAME}-$(date +%Y%m%d-%H%M%S)"

cd "$APP_DIR"

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Local changes detected. Stashing them as ${STASH_NAME}."
  git stash push -u -m "$STASH_NAME"
fi

git pull --ff-only origin "$BRANCH"
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start npm --name "$PM2_NAME" -- start
fi

pm2 save
echo "Deployment complete for ${PM2_NAME} on branch ${BRANCH}."
