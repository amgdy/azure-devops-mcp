#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import * as azdev from "azure-devops-node-api";
import { AccessToken, AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 <organization> [options]", "Azure DevOps MCP Server", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
      demandOption: true,
    });
  })
  .option("domains", {
    alias: "d",
    describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, required for multi-tenant scenarios)",
    type: "string",
  })
  .option("remote", {
    alias: "r",
    describe: "Run as remote MCP server with HTTP+SSE transport",
    type: "boolean",
    default: false,
  })
  .option("port", {
    alias: "p",
    describe: "Port for remote server (default: 3000)",
    type: "number",
    default: 3000,
  })
  .option("pat", {
    describe: "Azure DevOps Personal Access Token (can also be set via ADO_PAT environment variable)",
    type: "string",
  })
  .help()
  .parseSync();

const tenantId = argv.tenant;

export const orgName = argv.organization as string;
const orgUrl = "https://dev.azure.com/" + orgName;

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();

async function getAzureDevOpsToken(): Promise<AccessToken> {
  // Check if Personal Access Token is provided (for remote mode)
  const pat = argv.pat || process.env.ADO_PAT;
  if (pat) {
    // For PAT, we create a synthetic AccessToken object
    return {
      token: pat,
      expiresOnTimestamp: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year from now
    };
  }

  // Existing Azure credential flow for local mode
  if (process.env.ADO_MCP_AZURE_TOKEN_CREDENTIALS) {
    process.env.AZURE_TOKEN_CREDENTIALS = process.env.ADO_MCP_AZURE_TOKEN_CREDENTIALS;
  } else {
    process.env.AZURE_TOKEN_CREDENTIALS = "dev";
  }
  let credential: TokenCredential = new DefaultAzureCredential(); // CodeQL [SM05138] resolved by explicitly setting AZURE_TOKEN_CREDENTIALS
  if (tenantId) {
    // Use Azure CLI credential if tenantId is provided for multi-tenant scenarios
    const azureCliCredential = new AzureCliCredential({ tenantId });
    credential = new ChainedTokenCredential(azureCliCredential, credential);
  }

  const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
  if (!token) {
    throw new Error("Failed to obtain Azure DevOps token. Ensure you have Azure CLI logged in or another token source setup correctly.");
  }
  return token;
}

function getAzureDevOpsClient(userAgentComposer: UserAgentComposer): () => Promise<azdev.WebApi> {
  return async () => {
    const token = await getAzureDevOpsToken();
    
    // Check if we're using PAT authentication
    const pat = argv.pat || process.env.ADO_PAT;
    const authHandler = pat 
      ? azdev.getPersonalAccessTokenHandler(token.token)
      : azdev.getBearerHandler(token.token);
      
    const connection = new azdev.WebApi(orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

async function startRemoteServer() {
  const app = express();
  app.use(express.json());

  // Store transports by session ID
  const transports: { [sessionId: string]: SSEServerTransport } = {};

  // Create server instance factory
  const createServer = () => {
    const server = new McpServer({
      name: "Azure DevOps MCP Server",
      version: packageVersion,
    });

    const userAgentComposer = new UserAgentComposer(packageVersion);
    server.server.oninitialized = () => {
      userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
    };

    configurePrompts(server);
    configureAllTools(server, getAzureDevOpsToken, getAzureDevOpsClient(userAgentComposer), () => userAgentComposer.userAgent, enabledDomains);

    return server;
  };

  // SSE endpoint for establishing the stream
  app.get('/sse', async (req, res) => {
    console.log('Received GET request to /sse (establishing SSE stream)');
    try {
      // Create a new SSE transport for the client
      const transport = new SSEServerTransport('/messages', res);
      
      // Store the transport by session ID
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        console.log(`SSE transport closed for session ${sessionId}`);
        delete transports[sessionId];
      };

      // Connect the transport to the MCP server
      const server = createServer();
      await server.connect(transport);
      console.log(`Established SSE stream with session ID: ${sessionId}`);
    } catch (error) {
      console.error('Error establishing SSE stream:', error);
      if (!res.headersSent) {
        res.status(500).send('Error establishing SSE stream');
      }
    }
  });

  // Messages endpoint for receiving client JSON-RPC requests
  app.post('/messages', async (req, res) => {
    console.log('Received POST request to /messages');
    
    // Extract session ID from URL query parameter
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      console.error('No session ID provided in request URL');
      res.status(400).send('Missing sessionId parameter');
      return;
    }

    const transport = transports[sessionId];
    if (!transport) {
      console.error(`No active transport found for session ID: ${sessionId}`);
      res.status(404).send('Session not found');
      return;
    }

    try {
      // Handle the POST message with the transport
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).send('Error handling request');
      }
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', organization: orgName });
  });

  // Start the server
  const port = argv.port || 3000;
  app.listen(port, (error?: Error) => {
    if (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
    console.log(`Azure DevOps MCP Server (remote mode) listening on port ${port}`);
    console.log(`Organization: ${orgName}`);
    console.log(`Authentication: ${argv.pat || process.env.ADO_PAT ? 'Personal Access Token' : 'Azure Credentials'}`);
    console.log('Endpoints:');
    console.log(`  - SSE: http://localhost:${port}/sse`);
    console.log(`  - Messages: http://localhost:${port}/messages`);
    console.log(`  - Health: http://localhost:${port}/health`);
  });

  // Handle server shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    
    // Close all active transports to properly clean up resources
    for (const sessionId in transports) {
      try {
        console.log(`Closing transport for session ${sessionId}`);
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }
    
    console.log('Server shutdown complete');
    process.exit(0);
  });
}

async function main() {
  // Check if we should run in remote mode
  if (argv.remote) {
    await startRemoteServer();
    return;
  }

  // Local mode (existing behavior)
  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  configurePrompts(server);

  configureAllTools(server, getAzureDevOpsToken, getAzureDevOpsClient(userAgentComposer), () => userAgentComposer.userAgent, enabledDomains);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
