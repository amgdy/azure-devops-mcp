# Azure Container Apps Deployment for Azure DevOps MCP Server

This directory contains deployment templates and scripts for hosting the Azure DevOps MCP Server in Azure Container Apps.

## Prerequisites

1. Azure CLI installed and configured
2. Azure subscription with appropriate permissions
3. Resource group and Container Apps environment created

## Quick Deployment

### 1. Create Container Apps Environment

```bash
# Create resource group
az group create --name rg-azure-devops-mcp --location eastus2

# Create Container Apps environment
az containerapp env create \
  --name env-azure-devops-mcp \
  --resource-group rg-azure-devops-mcp \
  --location eastus2
```

### 2. Deploy the Container App

```bash
# Build and push image to Azure Container Registry (optional)
az acr create --name myregistry --resource-group rg-azure-devops-mcp --sku Basic
az acr build --registry myregistry --image azure-devops-mcp:latest .

# Deploy Container App
az containerapp create \
  --name azure-devops-mcp \
  --resource-group rg-azure-devops-mcp \
  --environment env-azure-devops-mcp \
  --image myregistry.azurecr.io/azure-devops-mcp:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1Gi \
  --env-vars \
    AZURE_DEVOPS_ORG=myorg \
    AZURE_TOKEN_CREDENTIALS=managed
```

### 3. Configure Managed Identity (Recommended)

```bash
# Create user-assigned managed identity
az identity create \
  --name id-azure-devops-mcp \
  --resource-group rg-azure-devops-mcp

# Get the identity details
IDENTITY_ID=$(az identity show --name id-azure-devops-mcp --resource-group rg-azure-devops-mcp --query id -o tsv)
CLIENT_ID=$(az identity show --name id-azure-devops-mcp --resource-group rg-azure-devops-mcp --query clientId -o tsv)

# Assign the identity to the container app
az containerapp identity assign \
  --name azure-devops-mcp \
  --resource-group rg-azure-devops-mcp \
  --user-assigned $IDENTITY_ID

# Update environment variables
az containerapp update \
  --name azure-devops-mcp \
  --resource-group rg-azure-devops-mcp \
  --set-env-vars \
    AZURE_CLIENT_ID=$CLIENT_ID
```

### 4. Configure Azure DevOps Permissions

Grant the managed identity appropriate permissions in your Azure DevOps organization:

1. Go to your Azure DevOps organization settings
2. Navigate to Users
3. Add the managed identity as a user
4. Assign appropriate access levels (Basic, Basic + Test Plans, etc.)

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `AZURE_DEVOPS_ORG` | Yes | Azure DevOps organization name | `myorg` |
| `AZURE_CLIENT_ID` | No | Managed identity client ID | Auto-detected |
| `AZURE_TENANT_ID` | No | Azure tenant ID | Auto-detected |
| `AZURE_TOKEN_CREDENTIALS` | No | Authentication mode | `managed` (default: `dev`) |

## Monitoring and Troubleshooting

### View Logs

```bash
az containerapp logs show \
  --name azure-devops-mcp \
  --resource-group rg-azure-devops-mcp \
  --follow
```

### Health Check

```bash
# Get the app URL
APP_URL=$(az containerapp show --name azure-devops-mcp --resource-group rg-azure-devops-mcp --query properties.configuration.ingress.fqdn -o tsv)

# Test health endpoint
curl https://$APP_URL/health
```

### Scale Configuration

```bash
# Update scaling rules
az containerapp update \
  --name azure-devops-mcp \
  --resource-group rg-azure-devops-mcp \
  --min-replicas 1 \
  --max-replicas 5
```

## Security Considerations

1. **Authentication**: Use managed identity for production deployments
2. **Network**: Configure ingress restrictions if needed
3. **Secrets**: Store sensitive values in Azure Key Vault
4. **CORS**: Configure allowed origins appropriately
5. **HTTPS**: Container Apps provides HTTPS by default

## Cost Optimization

- Set appropriate min/max replicas based on usage
- Use consumption plan for variable workloads
- Monitor resource usage and adjust CPU/memory allocation

## Support

For issues specific to Azure Container Apps deployment, refer to:
- [Azure Container Apps documentation](https://docs.microsoft.com/en-us/azure/container-apps/)
- [Azure DevOps authentication documentation](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/manage-conditional-access)