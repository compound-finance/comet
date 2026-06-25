#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Trapping: This ensures cleanup happens even if the script fails half-way
# A critical security practice for handling temporary sensitive data
cleanup() {
    if [ -f .env.forge-temp ]; then
        echo "[Cleanup] Removing temporary environment file..."
        rm .env.forge-temp
    fi
}
trap cleanup EXIT

echo "[1/4] Exporting dynamic network configurations..."
# Ensure the node script actually creates the file before proceeding
node scripts/exportNetworkConfigs.js

if [ ! -f .env.forge-temp ]; then
    echo "Error: .env.forge-temp not found. Export failed."
    exit 1
fi

echo "[2/4] Loading temporary environment variables..."
# Use allexport to safely import env vars into the current shell session
set -a
source .env.forge-temp
set +a

echo "[3/4] Running Forge tests (Optimizer: 1, via-IR: enabled)..."
# Logic: --via-ir is required for complex nested storage or high-stack contracts
# Optimization: --no-match-path isolates testing to relevant modules
forge test \
    -vvv \
    --via-ir \
    --optimizer-runs 1 \
    --no-match-path "./contracts/capo/*"

echo "[4/4] Execution finished successfully."
# Cleanup is handled automatically by the 'trap' on EXIT
