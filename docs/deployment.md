# Azure Container Apps Deployment

This document describes how to deploy the Azure DevOps MCP Server to Azure Container Apps using the provided Bicep templates.

## Prerequisites

- Azure CLI installed and configured
- Azure subscription with appropriate permissions
- Resource Group created for deployment

## Quick Deployment

### 1. Clone the Repository

```bash
git clone https://github.com/amgdy/azure-devops-mcp.git
cd azure-devops-mcp
```

### 2. Deploy Infrastructure

```bash
# Login to Azure
az login

# Set your subscription
az account set --subscription "your-subscription-id"

# Create resource group (if not exists)
az group create --name "rg-azuredevops-mcp" --location "East US 2"

# Deploy the Bicep template
az deployment group create \
  --resource-group "rg-azuredevops-mcp" \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters adoOrganization="your-ado-organization"
```

### 3. Update Parameters

Edit `infra/main.parameters.json` to customize your deployment:

```json
{
  "parameters": {
    "adoOrganization": {
      "value": "your-actual-ado-organization"
    },
    "containerImage": {
      "value": "ghcr.io/amgdy/azure-devops-mcp:latest"
    },
    "allowedOrigins": {
      "value": "https://your-client-domain.com"
    }
  }
}
```

## Deployment Parameters

| Parameter | Description | Default Value |
|-----------|-------------|---------------|
| `environmentName` | Name of the Container Apps Environment | `aca-env-azuredevops-mcp` |
| `containerAppName` | Name of the Container App | `azure-devops-mcp` |
| `adoOrganization` | Azure DevOps organization name | **Required** |
| `containerImage` | Container image to deploy | `ghcr.io/amgdy/azure-devops-mcp:latest` |
| `azureClientId` | Azure Client ID for managed identity | `` |
| `adoTenantId` | Azure Tenant ID | `` |
| `allowedOrigins` | CORS allowed origins | `*` |
| `location` | Azure region | Resource Group location |
| `minReplicas` | Minimum replicas | `1` |
| `maxReplicas` | Maximum replicas | `10` |
| `cpu` | CPU allocation | `0.5` |
| `memory` | Memory allocation | `1Gi` |

## Authentication Configuration

### Using Managed Identity (Recommended for Production)

1. Enable system-assigned managed identity on the Container App
2. Grant the identity appropriate permissions to your Azure DevOps organization
3. Set the `AZURE_CLIENT_ID` environment variable if using user-assigned identity

### Using Service Principal

1. Create a service principal and grant it access to your Azure DevOps organization
2. Store the credentials in Azure Key Vault
3. Configure the Container App to retrieve secrets from Key Vault

## Monitoring and Logs

The deployment includes:

- **Log Analytics Workspace**: Centralized logging for the Container Apps Environment
- **Health Probes**: Liveness and readiness checks on `/health` endpoint
- **Auto-scaling**: HTTP-based scaling with concurrent request limits

### Viewing Logs

```bash
# View application logs
az containerapp logs show \
  --name "azure-devops-mcp" \
  --resource-group "rg-azuredevops-mcp" \
  --follow

# View system logs
az monitor log-analytics query \
  --workspace "law-azuredevops-mcp" \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'azure-devops-mcp' | order by TimeGenerated desc"
```

## Scaling Configuration

The Container App is configured with:

- **Minimum replicas**: 1 (always-on)
- **Maximum replicas**: 10 (configurable)
- **Scaling rule**: HTTP requests (30 concurrent requests per replica)

Modify scaling in the Bicep template:

```bicep
scale: {
  minReplicas: minReplicas
  maxReplicas: maxReplicas
  rules: [
    {
      name: 'http-scaling'
      http: {
        metadata: {
          concurrentRequests: '30'
        }
      }
    }
  ]
}
```

## Custom Domain and SSL

To use a custom domain:

1. Configure custom domain in Container Apps
2. Update CORS `allowedOrigins` parameter
3. Configure DNS CNAME record

```bash
# Add custom domain
az containerapp hostname add \
  --name "azure-devops-mcp" \
  --resource-group "rg-azuredevops-mcp" \
  --hostname "mcp.yourdomain.com"
```

## Troubleshooting

### Common Issues

1. **Container fails to start**: Check environment variables and Azure DevOps organization access
2. **Authentication failures**: Verify managed identity permissions or service principal credentials
3. **CORS errors**: Update `allowedOrigins` parameter with correct client domains

### Debug Commands

```bash
# Check container app status
az containerapp show \
  --name "azure-devops-mcp" \
  --resource-group "rg-azuredevops-mcp" \
  --query "properties.provisioningState"

# View container app configuration
az containerapp show \
  --name "azure-devops-mcp" \
  --resource-group "rg-azuredevops-mcp" \
  --query "properties.template.containers[0].env"

# Test health endpoint
curl https://your-container-app-url.azurecontainerapps.io/health
```

## Cost Optimization

- Use **consumption-based pricing** for development/testing
- Configure **scale-to-zero** for non-production environments
- Set appropriate **CPU and memory limits** based on usage patterns
- Use **reserved capacity** for production workloads with predictable usage

## Security Best Practices

1. **Network Security**: Use Virtual Network integration for private communication
2. **Identity Management**: Prefer managed identity over service principals
3. **Secret Management**: Store sensitive configuration in Azure Key Vault
4. **Access Control**: Implement proper RBAC on the Container Apps resources
5. **Monitoring**: Enable diagnostic logs and set up alerts for security events