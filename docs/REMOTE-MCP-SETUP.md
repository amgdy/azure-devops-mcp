# Remote MCP Server Setup

This guide explains how to use the Azure DevOps MCP Server in remote mode with Server-Sent Events (SSE) transport.

## Overview

The Azure DevOps MCP Server supports two transport modes:
- **Local mode** (stdio): Direct process communication (default)
- **Remote mode** (SSE): HTTP-based communication with Server-Sent Events

Remote mode is useful when you want to run the MCP server as a separate service or when working with web-based MCP clients.

## Configuration in mcp.json

The repository includes pre-configured server definitions in `mcp.json`:

### Available Configurations

1. **ado-local**: Standard local mode using stdio transport
2. **ado-remote**: Remote mode with custom port input
3. **ado-remote-default**: Remote mode on default port 3000

### Example mcp.json Configuration

```json
{
  "inputs": [
    {
      "id": "ado_org",
      "type": "promptString",
      "description": "Azure DevOps organization name (e.g. 'contoso')"
    },
    {
      "id": "ado_pat",
      "type": "promptString",
      "description": "Azure DevOps Personal Access Token (for remote server)"
    },
    {
      "id": "server_port",
      "type": "promptString",
      "description": "Remote server port (default: 3000)"
    }
  ],
  "servers": {
    "ado-remote-default": {
      "type": "sse",
      "command": "mcp-server-azuredevops",
      "args": ["${input:ado_org}", "--remote", "--port", "3000", "--pat", "${input:ado_pat}"],
      "url": "http://localhost:3000/sse",
      "description": "Remote Azure DevOps MCP Server on default port 3000"
    }
  }
}
```

## How It Works

When you select a remote server configuration:

1. **MCP Client prompts** for required inputs:
   - Organization name (e.g., "contoso")
   - Personal Access Token
   - Server port (if using custom port config)

2. **Server process starts** automatically with the provided parameters:
   ```bash
   mcp-server-azuredevops contoso --remote --port 3000 --pat your-token
   ```

3. **Client connects** to the SSE endpoint at `http://localhost:3000/sse`

## Personal Access Token Requirements

For remote mode, you must provide a Personal Access Token (PAT) with appropriate permissions:

1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Create a new token with these scopes:
   - **Work Items**: Read & Write
   - **Code**: Read
   - **Build**: Read
   - **Test Plans**: Read
   - **Wiki**: Read

## Troubleshooting

### "Error sending message to http://localhost:3000/sse: TypeError: fetch failed"

This error occurs when the remote server is not running or not accessible. The new configuration should automatically start the server process, but if you still see this error:

1. Check that the server process started successfully
2. Verify the port is not being used by another process
3. Ensure your PAT is valid and has sufficient permissions

### Server Not Starting

If the server fails to start:

1. Verify your Azure DevOps organization name is correct
2. Check that your PAT is valid and has the required permissions
3. Ensure the specified port is available

### Connection Issues

If you can connect but get authentication errors:

1. Verify your PAT has the required scopes (see above)
2. Check that the organization name matches exactly
3. Ensure the PAT hasn't expired

## Manual Server Testing

You can manually test the remote server:

```bash
# Start the server
npm run build
node dist/index.js contoso --remote --port 3000 --pat your-token

# Test health endpoint
curl http://localhost:3000/health
```

Should return:
```json
{"status":"healthy","organization":"contoso"}
```

## Available Endpoints

When running in remote mode, the server exposes:

- **SSE Stream**: `http://localhost:3000/sse` - For establishing the MCP connection
- **Messages**: `http://localhost:3000/messages` - For JSON-RPC communication
- **Health Check**: `http://localhost:3000/health` - For monitoring server status