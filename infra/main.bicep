@description('Name of the Container Apps Environment')
param environmentName string = 'aca-env-azuredevops-mcp'

@description('Name of the Container App')
param containerAppName string = 'azure-devops-mcp'

@description('Azure DevOps organization name')
param adoOrganization string

@description('Container image to deploy')
param containerImage string = 'ghcr.io/amgdy/azure-devops-mcp:latest'

@description('Azure Client ID for managed identity (optional)')
param azureClientId string = ''

@description('Azure Tenant ID (optional)')
param adoTenantId string = ''

@description('Comma-separated list of allowed origins for CORS')
param allowedOrigins string = '*'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Log Analytics workspace name')
param logAnalyticsWorkspaceName string = 'law-azuredevops-mcp'

@description('Enable ingress for external access')
param enableIngress bool = true

@description('Target port for the container')
param targetPort int = 3000

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 10

@description('CPU allocation for the container')
param cpu string = '0.5'

@description('Memory allocation for the container')
param memory string = '1Gi'

// Log Analytics Workspace
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// Container Apps Environment
resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// Container App
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: enableIngress ? {
        external: true
        targetPort: targetPort
        allowInsecure: false
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      } : null
      secrets: []
      registries: []
    }
    template: {
      containers: [
        {
          name: 'azure-devops-mcp'
          image: containerImage
          env: [
            {
              name: 'ADO_ORGANIZATION'
              value: adoOrganization
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: azureClientId
            }
            {
              name: 'ADO_TENANT_ID'
              value: adoTenantId
            }
            {
              name: 'MCP_HTTP_MODE'
              value: 'true'
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'ALLOWED_ORIGINS'
              value: allowedOrigins
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
          ]
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
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
    }
  }
}

// Outputs
@description('The FQDN of the container app')
output containerAppFQDN string = enableIngress ? containerApp.properties.configuration.ingress.fqdn : ''

@description('The URL of the MCP endpoint')
output mcpEndpointUrl string = enableIngress ? 'https://${containerApp.properties.configuration.ingress.fqdn}/mcp' : ''

@description('The name of the Container Apps Environment')
output environmentName string = containerAppsEnvironment.name

@description('The name of the Container App')
output containerAppName string = containerApp.name