#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as azdev from "azure-devops-node-api";
import { AccessToken, AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";
import { randomUUID } from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 <organization>", "Azure DevOps MCP Server", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
    });
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, required for multi-tenant scenarios)",
    type: "string",
  })
  .option("http", {
    describe: "Run as HTTP server instead of STDIO transport",
    type: "boolean",
    default: false,
  })
  .option("port", {
    alias: "p",
    describe: "Port for HTTP server (only used with --http)",
    type: "number",
    default: 3000,
  })
  .help()
  .parseSync();

export const orgName = argv.organization as string;
const tenantId = argv.tenant;
const httpMode = argv.http || process.env.MCP_HTTP_MODE === "true";
const port = argv.port || parseInt(process.env.PORT || "3000");
const orgUrl = "https://dev.azure.com/" + orgName;

async function getAzureDevOpsToken(): Promise<AccessToken> {
  if (httpMode) {
    // In HTTP mode, prefer managed identity and default credential chain for cloud deployment
    const credential: TokenCredential = new DefaultAzureCredential({
      managedIdentityClientId: process.env.AZURE_CLIENT_ID,
      tenantId: tenantId,
    });
    
    const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
    if (!token) {
      throw new Error("Failed to obtain Azure DevOps token. Ensure you have proper Azure credentials configured for HTTP mode.");
    }
    return token;
  } else {
    // Original STDIO mode authentication
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
}

function getAzureDevOpsClient(userAgentComposer: UserAgentComposer): () => Promise<azdev.WebApi> {
  return async () => {
    const token = await getAzureDevOpsToken();
    const authHandler = azdev.getBearerHandler(token.token);
    const connection = new azdev.WebApi(orgUrl, authHandler, undefined, {
      productName: httpMode ? "AzureDevOps.MCP.Remote" : "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: httpMode ? "Azure DevOps MCP Server (HTTP)" : "Azure DevOps MCP Server",
    version: packageVersion,
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  configurePrompts(server);
  configureAllTools(server, getAzureDevOpsToken, getAzureDevOpsClient(userAgentComposer), () => userAgentComposer.userAgent);

  return server;
}

async function startHttpServer() {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for SSE to work
  }));

  // CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];
  app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Session-ID"],
    credentials: true,
  }));

  // JSON parsing middleware
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      version: packageVersion,
      organization: orgName,
      timestamp: new Date().toISOString(),
    });
  });

  // Root endpoint info
  app.get("/", (req, res) => {
    res.json({
      name: "Azure DevOps MCP Server",
      version: packageVersion,
      organization: orgName,
      endpoints: {
        mcp: "/mcp",
        health: "/health",
      },
      transport: "StreamableHTTPServerTransport",
    });
  });

  // MCP endpoint handler
  app.all("/mcp", async (req, res) => {
    try {
      // Create a new MCP server instance for each request
      const mcpServer = await createMcpServer();

      // Configure the HTTP transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: false, // Use SSE streaming
        allowedHosts: process.env.ALLOWED_HOSTS?.split(","),
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(","),
        enableDnsRebindingProtection: process.env.ENABLE_DNS_REBINDING_PROTECTION === "true",
      });

      // Connect the MCP server to the transport
      await mcpServer.connect(transport);

      // Handle the HTTP request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  });

  // Start the server
  const server = app.listen(port, () => {
    console.log(`Azure DevOps MCP HTTP Server v${packageVersion} started`);
    console.log(`Organization: ${orgName}`);
    console.log(`Port: ${port}`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`Health check: http://localhost:${port}/health`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("Received SIGTERM, shutting down gracefully");
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("Received SIGINT, shutting down gracefully");
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
  });
}

async function startStdioServer() {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  if (httpMode) {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
