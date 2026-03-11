#!/bin/bash
set -e

echo "Installing server dependencies..."
cd server && npm install --production && cd ..

echo "Installing frontend dependencies..."
cd lextrack && npm install

echo "Building frontend..."
GENERATE_SOURCEMAP=false CI=false NODE_OPTIONS="--max-old-space-size=512" npm run build

echo "Build complete!"
