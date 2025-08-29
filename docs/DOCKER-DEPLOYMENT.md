# Docker Deployment Guide

This guide explains how to deploy the Azure DevOps MCP Server using Docker for production or development environments.

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Azure DevOps Personal Access Token (PAT)
- Azure DevOps organization name

### Basic Docker Run

```bash
# Build the image
npm run docker:build

# Run with environment variables
docker run -d \
  --name ado-mcp-server \
  -p 3000:3000 \
  -e ADO_ORG="your-org" \
  -e ADO_PAT="your-token" \
  ado-mcp-server
```

### Using Docker Compose

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Edit `.env` with your values:
```bash
ADO_ORG=your-organization
ADO_PAT=your-personal-access-token
```

3. Start the services:
```bash
npm run docker:compose:up
```

### Using the Convenience Script

```bash
# Make script executable (if not already)
chmod +x docker-run.sh

# Run with parameters
./docker-run.sh your-org your-token

# Or use environment variable
ADO_PAT="your-token" ./docker-run.sh your-org
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADO_ORG` | Yes | contoso | Azure DevOps organization name |
| `ADO_PAT` | Yes | - | Personal Access Token |
| `NODE_ENV` | No | production | Node.js environment |
| `SERVER_PORT` | No | 3000 | Internal server port |

### Health Checking

The container includes a built-in health check:
```bash
# Check health manually
npm run docker:health

# Or direct curl
curl http://localhost:3000/health
```

## VSCode Development

### Launch Configurations

Use the provided VSCode launch configurations for debugging:

- **Debug Local MCP Server**: Standard local debugging
- **Debug Remote MCP Server**: Debug remote mode with PAT
- **Debug with Custom Config**: Fully customizable parameters
- **Debug Tests**: Run and debug Jest tests
- **Run MCP Inspector**: Use MCP Inspector for interactive testing

### Build Tasks

Available VSCode tasks:
- `npm: build` - Build TypeScript
- `npm: watch` - Watch mode for development
- `npm: test` - Run tests
- `npm: docker:build` - Build Docker image
- `npm: docker:compose:up` - Start with Docker Compose

## Production Deployment

### Security Considerations

1. **Use HTTPS**: Configure a reverse proxy (nginx, traefik) for SSL termination
2. **Environment Security**: Store PAT in secure secret management
3. **Network Security**: Use internal networks and proper firewall rules
4. **Resource Limits**: Set appropriate memory and CPU limits

### Example Production Docker Compose

```yaml
version: '3.8'
services:
  ado-mcp-server:
    image: ado-mcp-server:latest
    restart: unless-stopped
    environment:
      - ADO_ORG=${ADO_ORG}
      - ADO_PAT=${ADO_PAT}
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
    networks:
      - internal
    
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - ado-mcp-server
    networks:
      - internal

networks:
  internal:
    driver: bridge
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ado-mcp-server
spec:
  replicas: 2
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
        image: ado-mcp-server:latest
        ports:
        - containerPort: 3000
        env:
        - name: ADO_ORG
          value: "your-org"
        - name: ADO_PAT
          valueFrom:
            secretKeyRef:
              name: ado-secret
              key: token
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
          requests:
            memory: "256Mi"
            cpu: "250m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: ado-mcp-service
spec:
  selector:
    app: ado-mcp-server
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

## Troubleshooting

### Common Issues

1. **Health check fails**: Verify the server is starting correctly and port 3000 is accessible
2. **Authentication errors**: Check ADO_PAT is valid and has necessary permissions
3. **Connection refused**: Ensure the container is running and port mapping is correct

### Debug Commands

```bash
# View container logs
docker logs ado-mcp-server

# Execute shell in container
docker exec -it ado-mcp-server sh

# Check container status
docker ps -a

# Inspect container
docker inspect ado-mcp-server
```

### Performance Monitoring

```bash
# Container stats
docker stats ado-mcp-server

# Health endpoint
curl -i http://localhost:3000/health

# Application logs
docker logs -f ado-mcp-server
```