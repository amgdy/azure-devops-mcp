#!/bin/bash

# Build and run Azure DevOps MCP Server in Docker
# Usage: ./docker-run.sh [organization] [pat]

set -e

# Default values
ORG_NAME=${1:-contoso}
PAT_TOKEN=${2:-$ADO_PAT}
PORT=${3:-3000}

# Validate required parameters
if [ -z "$PAT_TOKEN" ]; then
    echo "Error: Personal Access Token is required"
    echo "Usage: $0 [organization] [pat] [port]"
    echo "   or: ADO_PAT=your-token $0 [organization]"
    exit 1
fi

echo "Building Azure DevOps MCP Server Docker image..."
docker build -t ado-mcp-server .

echo "Running Azure DevOps MCP Server..."
echo "Organization: $ORG_NAME"
echo "Port: $PORT"
echo "Health check: http://localhost:$PORT/health"

docker run -it --rm \
    --name ado-mcp-server \
    -p $PORT:3000 \
    -e ADO_ORG="$ORG_NAME" \
    -e ADO_PAT="$PAT_TOKEN" \
    -e NODE_ENV=production \
    ado-mcp-server

echo "Server stopped."