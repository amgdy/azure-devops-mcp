# 🚀 Remote MCP Server Deployment Guide

This guide explains how to deploy and use the Azure DevOps MCP Server as a remote server using HTTP+SSE transport.

## 📋 Table of Contents

- [Overview](#-overview)
- [Prerequisites](#-prerequisites)
- [Authentication Setup](#-authentication-setup)
- [Local Development](#-local-development)
- [Production Deployment](#-production-deployment)
- [Client Configuration](#-client-configuration)
- [Troubleshooting](#-troubleshooting)

## 🌟 Overview

The Azure DevOps MCP Server supports two modes:

1. **Local Mode** (default): Uses stdio transport for direct integration with MCP clients
2. **Remote Mode**: Uses HTTP+SSE transport for network-based communication

Remote mode is ideal for:
- Centralized deployments serving multiple clients
- Cloud deployments (Docker, Kubernetes, etc.)
- Scenarios where clients can't run local processes
- Multi-user environments

## 🔧 Prerequisites

### System Requirements
- Node.js 18+ 
- npm or yarn package manager
- Network access to Azure DevOps Services

### Azure DevOps Setup
- Azure DevOps organization
- Personal Access Token (PAT) with appropriate permissions

## 🔐 Authentication Setup

### Creating a Personal Access Token

1. Go to your Azure DevOps organization settings
2. Navigate to **Security** > **Personal Access Tokens**
3. Click **New Token**
4. Configure the token:
   - **Name**: "MCP Server Remote Access" (or your preferred name)
   - **Organization**: Select your organization
   - **Expiration**: Set appropriate expiration (recommended: 90 days or less)
   - **Scopes**: Select the following scopes based on your needs:
     - **Code**: Read (for repositories)
     - **Build**: Read & execute (for builds and pipelines)
     - **Work items**: Read & write (for work items)
     - **Release**: Read (for releases)
     - **Test management**: Read (for test plans)
     - **Wiki**: Read & write (for wiki)
     - **Analytics**: Read (for advanced security)

5. Click **Create** and copy the token immediately

### Environment Variables

Set the PAT using environment variables (recommended for production):

```bash
export ADO_PAT="your-personal-access-token-here"
```

Alternatively, you can pass it as a command line argument (not recommended for production):

```bash
--pat your-personal-access-token-here
```

## 💻 Local Development

### Installation

```bash
# Install the package globally
npm install -g @azure-devops/mcp

# Or clone and build from source
git clone https://github.com/microsoft/azure-devops-mcp.git
cd azure-devops-mcp
npm install
npm run build
```

### Running Locally

```bash
# Using environment variable (recommended)
export ADO_PAT="your-pat-token"
mcp-server-azuredevops your-org-name --remote

# Using command line argument
mcp-server-azuredevops your-org-name --remote --pat your-pat-token

# Custom port
mcp-server-azuredevops your-org-name --remote --port 8080

# Specific domains only
mcp-server-azuredevops your-org-name --remote --domains repositories builds
```

### Verification

The server will start and display:

```
Azure DevOps MCP Server (remote mode) listening on port 3000
Organization: your-org-name
Authentication: Personal Access Token
Endpoints:
  - SSE: http://localhost:3000/sse
  - Messages: http://localhost:3000/messages
  - Health: http://localhost:3000/health
```

Test the health endpoint:

```bash
curl http://localhost:3000/health
# Expected response: {"status":"healthy","organization":"your-org-name"}
```

## 🏭 Production Deployment

### Docker Deployment

1. Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install the MCP server
RUN npm install -g @azure-devops/mcp

# Expose the port
EXPOSE 3000

# Set default command
CMD ["mcp-server-azuredevops", "your-org-name", "--remote"]
```

2. Build and run:

```bash
# Build the image
docker build -t ado-mcp-server .

# Run with environment variable
docker run -d \
  --name ado-mcp-server \
  -p 3000:3000 \
  -e ADO_PAT="your-pat-token" \
  ado-mcp-server
```

### Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  ado-mcp-server:
    image: node:18-alpine
    container_name: ado-mcp-server
    working_dir: /app
    command: >
      sh -c "npm install -g @azure-devops/mcp && 
             mcp-server-azuredevops your-org-name --remote"
    ports:
      - "3000:3000"
    environment:
      - ADO_PAT=your-pat-token
    restart: unless-stopped
```

### Kubernetes Deployment

1. Create a secret for the PAT:

```bash
kubectl create secret generic ado-pat \
  --from-literal=token="your-pat-token"
```

2. Create a deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ado-mcp-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ado-mcp-server
  template:
    metadata:
      labels:
        app: ado-mcp-server
    spec:
      containers:
      - name: ado-mcp-server
        image: node:18-alpine
        command: 
        - sh
        - -c
        - |
          npm install -g @azure-devops/mcp
          mcp-server-azuredevops your-org-name --remote
        ports:
        - containerPort: 3000
        env:
        - name: ADO_PAT
          valueFrom:
            secretKeyRef:
              name: ado-pat
              key: token
---
apiVersion: v1
kind: Service
metadata:
  name: ado-mcp-server-service
spec:
  selector:
    app: ado-mcp-server
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### Cloud Platforms

#### Azure Container Instances

```bash
az container create \
  --resource-group myResourceGroup \
  --name ado-mcp-server \
  --image node:18-alpine \
  --command-line "sh -c 'npm install -g @azure-devops/mcp && mcp-server-azuredevops your-org-name --remote'" \
  --environment-variables ADO_PAT="your-pat-token" \
  --ports 3000 \
  --dns-name-label ado-mcp-server
```

#### AWS ECS / Google Cloud Run

Follow the respective platform documentation for container deployment, using the Docker image configuration above.

## 🔌 Client Configuration

### MCP Client Configuration

Configure your MCP client to connect to the remote server:

```json
{
  "mcpServers": {
    "ado-remote": {
      "command": "npx",
      "args": ["@modelcontextprotocol/client-sse", "http://your-server:3000/sse"]
    }
  }
}
```

### Security Considerations

- **HTTPS**: Use HTTPS in production deployments
- **Authentication**: The PAT provides authentication to Azure DevOps, but consider adding client authentication for the MCP server itself
- **Network Security**: Restrict network access using firewalls, VPNs, or private networks
- **Token Rotation**: Regularly rotate your PAT tokens

## 🐛 Troubleshooting

### Common Issues

#### Server Won't Start

```bash
# Check if port is available
netstat -ln | grep 3000

# Try a different port
mcp-server-azuredevops your-org-name --remote --port 8080
```

#### Authentication Errors

```bash
# Verify PAT token has correct permissions
curl -u :your-pat-token https://dev.azure.com/your-org/_apis/projects

# Check environment variable
echo $ADO_PAT
```

#### Connection Issues

```bash
# Test health endpoint
curl http://your-server:3000/health

# Check SSE endpoint
curl -v http://your-server:3000/sse
```

### Logging

Enable verbose logging by setting environment variable:

```bash
export NODE_ENV=development
```

### Health Monitoring

The `/health` endpoint returns server status:

```json
{
  "status": "healthy",
  "organization": "your-org-name"
}
```

Use this endpoint for:
- Load balancer health checks
- Monitoring systems
- Container orchestration health probes

## 🔄 Migration from Local Mode

To migrate from local to remote mode:

1. **Test First**: Run the remote server locally to verify functionality
2. **Update Client Configuration**: Change from stdio to SSE transport
3. **Deploy Server**: Follow the deployment steps above
4. **Update Scripts**: Modify any automation to use the remote endpoints

## 📚 Additional Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [Azure DevOps REST API](https://docs.microsoft.com/en-us/rest/api/azure/devops/)
- [Personal Access Token Documentation](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)