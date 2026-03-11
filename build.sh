#!/bin/bash
set -e

echo "Installing server dependencies..."
cd server && npm install --production && cd ..

echo "Installing frontend dependencies..."
cd lextrack && npm install

echo "Building frontend..."
CI=false npm run build

echo "Build complete!"
