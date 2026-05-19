#!/usr/bin/env bash
# exit on error
set -o errexit

echo "====== START OF RENDER BUILD SCRIPT ======"

# 1. Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# 2. Tell Puppeteer to download Chromium into the project root (.cache folder)
# This ensures Render packages it and carries it over to the runtime container!
export PUPPETEER_CACHE_DIR=$(pwd)/.cache/puppeteer
echo "🌐 Puppeteer Cache Directory set to: $PUPPETEER_CACHE_DIR"

echo "📥 Installing Chrome binary..."
npx puppeteer browsers install chrome

echo "====== BUILD SUCCESSFUL ======"
