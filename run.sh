#!/bin/bash

# Script to run video upload automation
# Usage: ./run.sh

set -e

echo "Starting video upload process..."

# Run the upload command
npm run upload

# Check exit status
if [ $? -eq 0 ]; then
    echo "Upload process completed successfully"
    exit 0
else
    echo "Upload process failed"
    exit 1
fi

