#!/bin/bash

# Azure DevOps MCP Server Deployment Script
# This script deploys the Azure DevOps MCP Server to Azure Container Apps

set -e

# Default values
RESOURCE_GROUP=""
LOCATION="East US 2"
ADO_ORGANIZATION=""
SUBSCRIPTION_ID=""
CONTAINER_IMAGE="ghcr.io/amgdy/azure-devops-mcp:latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy Azure DevOps MCP Server to Azure Container Apps

OPTIONS:
    -g, --resource-group     Azure resource group name (required)
    -l, --location          Azure region (default: East US 2)
    -o, --organization      Azure DevOps organization name (required)
    -s, --subscription      Azure subscription ID (required)
    -i, --image             Container image (default: ghcr.io/amgdy/azure-devops-mcp:latest)
    -h, --help              Show this help message

EXAMPLES:
    $0 -g rg-azuredevops-mcp -o myorg -s 12345678-1234-1234-1234-123456789012
    $0 --resource-group rg-azuredevops-mcp --organization myorg --subscription 12345678-1234-1234-1234-123456789012 --location "West US 2"

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -l|--location)
            LOCATION="$2"
            shift 2
            ;;
        -o|--organization)
            ADO_ORGANIZATION="$2"
            shift 2
            ;;
        -s|--subscription)
            SUBSCRIPTION_ID="$2"
            shift 2
            ;;
        -i|--image)
            CONTAINER_IMAGE="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown parameter: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$RESOURCE_GROUP" ]]; then
    print_error "Resource group is required. Use -g or --resource-group."
    show_usage
    exit 1
fi

if [[ -z "$ADO_ORGANIZATION" ]]; then
    print_error "Azure DevOps organization is required. Use -o or --organization."
    show_usage
    exit 1
fi

if [[ -z "$SUBSCRIPTION_ID" ]]; then
    print_error "Azure subscription ID is required. Use -s or --subscription."
    show_usage
    exit 1
fi

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed. Please install it first."
    exit 1
fi

print_info "Starting deployment of Azure DevOps MCP Server..."
print_info "Resource Group: $RESOURCE_GROUP"
print_info "Location: $LOCATION"
print_info "Azure DevOps Organization: $ADO_ORGANIZATION"
print_info "Container Image: $CONTAINER_IMAGE"

# Login check
print_info "Checking Azure CLI login status..."
if ! az account show &>/dev/null; then
    print_warning "Not logged in to Azure. Please login..."
    az login
fi

# Set subscription
print_info "Setting Azure subscription..."
az account set --subscription "$SUBSCRIPTION_ID"

# Create resource group if it doesn't exist
print_info "Creating resource group if it doesn't exist..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Check if Bicep template exists
if [[ ! -f "infra/main.bicep" ]]; then
    print_error "Bicep template not found at infra/main.bicep"
    print_error "Please run this script from the repository root directory."
    exit 1
fi

# Deploy the Bicep template
print_info "Deploying Azure Container Apps infrastructure..."
DEPLOYMENT_OUTPUT=$(az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --template-file infra/main.bicep \
    --parameters adoOrganization="$ADO_ORGANIZATION" \
    --parameters containerImage="$CONTAINER_IMAGE" \
    --parameters location="$LOCATION" \
    --output json)

if [[ $? -eq 0 ]]; then
    print_success "Deployment completed successfully!"
    
    # Extract outputs
    CONTAINER_APP_FQDN=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.containerAppFQDN.value // empty')
    MCP_ENDPOINT_URL=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.mcpEndpointUrl.value // empty')
    
    if [[ -n "$CONTAINER_APP_FQDN" ]]; then
        print_success "Container App URL: https://$CONTAINER_APP_FQDN"
        print_success "MCP Endpoint URL: $MCP_ENDPOINT_URL"
        print_success "Health Check URL: https://$CONTAINER_APP_FQDN/health"
        
        echo
        print_info "Testing health endpoint..."
        sleep 30  # Wait for container to start
        
        if curl -s -o /dev/null -w "%{http_code}" "https://$CONTAINER_APP_FQDN/health" | grep -q "200"; then
            print_success "Health check passed! The service is running."
        else
            print_warning "Health check failed. The service might still be starting up."
            print_info "You can check the logs with:"
            echo "az containerapp logs show --name azure-devops-mcp --resource-group $RESOURCE_GROUP --follow"
        fi
        
        echo
        print_info "To use this MCP server, add the following to your MCP client configuration:"
        cat << EOF
{
  "servers": {
    "ado-remote": {
      "type": "sse",
      "url": "$MCP_ENDPOINT_URL"
    }
  }
}
EOF
    fi
else
    print_error "Deployment failed!"
    exit 1
fi