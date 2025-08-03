# Azure DevOps MCP Server - Remote Configuration Examples

This document provides examples for configuring clients to connect to the remote Azure DevOps MCP server.

## Remote MCP Configuration

### VS Code Configuration (`.vscode/mcp.json`)

For a remote HTTP server:

```json
{
  "servers": {
    "ado-remote": {
      "type": "sse",
      "url": "https://your-mcp-server.azurecontainerapps.io/mcp"
    }
  }
}
```

### Claude Desktop Configuration

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "azure-devops": {
      "type": "sse",
      "url": "https://your-mcp-server.azurecontainerapps.io/mcp"
    }
  }
}
```

### Environment Variables for Container Deployment

Set these environment variables when deploying to Azure Container Apps or App Service:

```bash
# Required
ADO_ORGANIZATION=your-organization-name

# Optional - for managed identity authentication
AZURE_CLIENT_ID=your-managed-identity-client-id

# Optional - for multi-tenant scenarios  
ADO_TENANT_ID=your-tenant-id

# Optional - CORS configuration
ALLOWED_ORIGINS=https://your-client-domain.com,https://another-domain.com

# Optional - DNS rebinding protection
ALLOWED_HOSTS=your-mcp-server.azurecontainerapps.io
ENABLE_DNS_REBINDING_PROTECTION=true

# Server configuration
PORT=3000
MCP_HTTP_MODE=true
```

## Authentication Setup

### For Azure Container Apps (Recommended)

1. Enable managed identity on your Container App
2. Grant the managed identity access to your Azure DevOps organization
3. Set the `AZURE_CLIENT_ID` environment variable to the managed identity client ID

### For Azure App Service

Similar to Container Apps - enable managed identity and configure access.

### For Development

You can still use Azure CLI authentication by running `az login` before starting the server locally.

## Security Considerations

1. **HTTPS Only**: Always use HTTPS in production
2. **CORS Configuration**: Set specific allowed origins instead of "*" in production
3. **DNS Rebinding Protection**: Enable in production environments
4. **Managed Identity**: Use managed identity for authentication in Azure deployments
5. **Network Security**: Consider using Virtual Networks and private endpoints for enhanced security

## Deployment Examples

### Azure Container Apps with Azure CLI

```bash
# Create a Container App
az containerapp create \
  --name azure-devops-mcp \
  --resource-group myResourceGroup \
  --environment myContainerAppEnvironment \
  --image your-registry.azurecr.io/azure-devops-mcp:latest \
  --target-port 3000 \
  --ingress external \
  --env-vars ADO_ORGANIZATION=your-org MCP_HTTP_MODE=true \
  --cpu 0.5 --memory 1Gi
```

### Docker Run Example

```bash
docker run -d \
  --name azure-devops-mcp \
  -p 3000:3000 \
  -e ADO_ORGANIZATION=your-org \
  -e MCP_HTTP_MODE=true \
  your-registry.azurecr.io/azure-devops-mcp:latest
```