#!/bin/bash
set -e

echo "Installing root dependencies..."
npm install

echo "Installing server dependencies..."
cd server
npm install
cd ..

echo "Installing frontend dependencies..."
cd lextrack
npm install

echo "Building frontend..."
CI=false npm run build
