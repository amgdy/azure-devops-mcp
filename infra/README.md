# Azure DevOps MCP Server - Infrastructure

This directory contains Bicep templates for deploying the Azure DevOps MCP Server to Azure Container Apps.

## Files

- **main.bicep**: Main Bicep template for Container Apps Environment and Container App
- **main.parameters.json**: Default parameter values for the deployment
- **README.md**: This file

## Quick Start

1. Update the parameters in `main.parameters.json` with your values:
   - `adoOrganization`: Your Azure DevOps organization name
   - `containerImage`: Container image to deploy (default uses GitHub Container Registry)
   - `location`: Azure region for deployment

2. Deploy using Azure CLI:
   ```bash
   az deployment group create \
     --resource-group "your-resource-group" \
     --template-file main.bicep \
     --parameters main.parameters.json
   ```

## Resources Deployed

- **Log Analytics Workspace**: For centralized logging
- **Container Apps Environment**: Managed environment for container apps
- **Container App**: The Azure DevOps MCP Server application with:
  - Auto-scaling based on HTTP requests
  - Health probes for monitoring
  - External ingress enabled
  - Production-ready configuration

## Configuration

The Container App is configured with the following environment variables:

- `ADO_ORGANIZATION`: Azure DevOps organization name
- `AZURE_CLIENT_ID`: Azure Client ID for managed identity (optional)
- `ADO_TENANT_ID`: Azure Tenant ID (optional)
- `MCP_HTTP_MODE`: Set to "true" for HTTP mode
- `PORT`: Container port (3000)
- `ALLOWED_ORIGINS`: CORS allowed origins
- `NODE_ENV`: Set to "production"

## Outputs

The template provides the following outputs:

- `containerAppFQDN`: The fully qualified domain name of the container app
- `mcpEndpointUrl`: The URL for the MCP endpoint
- `environmentName`: Name of the Container Apps Environment
- `containerAppName`: Name of the Container App

## Security

The deployment includes:

- Non-root container execution
- Health probes for reliability
- Configurable CORS origins
- Log Analytics integration for monitoring