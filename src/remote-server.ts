// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import * as azdev from "azure-devops-node-api";
import { AccessToken, AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";

import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";

export interface RemoteServerOptions {
  orgName: string;
  tenantId?: string;
  port?: number;
  allowedOrigins?: string[];
  allowedHosts?: string[];
}

export class AzureDevOpsRemoteServer {
  private app: express.Application;
  private server: any;
  private transports: Map<string, StreamableHTTPServerTransport | SSEServerTransport> = new Map();
  private options: RemoteServerOptions;
  private orgUrl: string;

  constructor(options: RemoteServerOptions) {
    this.options = options;
    this.orgUrl = "https://dev.azure.com/" + options.orgName;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    
    // Configure CORS to expose Mcp-Session-Id header for browser-based clients
    this.app.use(cors({
      origin: this.options.allowedOrigins || '*',
      exposedHeaders: ['Mcp-Session-Id'],
      credentials: true
    }));
  }

  private async getAzureDevOpsToken(): Promise<AccessToken> {
    if (process.env.ADO_MCP_AZURE_TOKEN_CREDENTIALS) {
      process.env.AZURE_TOKEN_CREDENTIALS = process.env.ADO_MCP_AZURE_TOKEN_CREDENTIALS;
    } else {
      process.env.AZURE_TOKEN_CREDENTIALS = "dev";
    }
    
    let credential: TokenCredential = new DefaultAzureCredential();
    if (this.options.tenantId) {
      const azureCliCredential = new AzureCliCredential({ tenantId: this.options.tenantId });
      credential = new ChainedTokenCredential(azureCliCredential, credential);
    }

    const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
    if (!token) {
      throw new Error("Failed to obtain Azure DevOps token. Ensure you have Azure CLI logged in or another token source setup correctly.");
    }
    return token;
  }

  private getAzureDevOpsClient(userAgentComposer: UserAgentComposer): () => Promise<azdev.WebApi> {
    return async () => {
      const token = await this.getAzureDevOpsToken();
      const authHandler = azdev.getBearerHandler(token.token);
      const connection = new azdev.WebApi(this.orgUrl, authHandler, undefined, {
        productName: "AzureDevOps.MCP.Remote",
        productVersion: packageVersion,
        userAgent: userAgentComposer.userAgent,
      });
      return connection;
    };
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: "Azure DevOps MCP Remote Server",
      version: packageVersion,
    }, { capabilities: { logging: {} } });

    const userAgentComposer = new UserAgentComposer(packageVersion);
    server.server.oninitialized = () => {
      userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
    };

    configurePrompts(server);
    configureAllTools(
      server,
      () => this.getAzureDevOpsToken(),
      this.getAzureDevOpsClient(userAgentComposer),
      () => userAgentComposer.userAgent
    );

    return server;
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        organization: this.options.orgName,
        version: packageVersion,
        timestamp: new Date().toISOString()
      });
    });

    // Streamable HTTP Transport (Protocol version 2025-03-26)
    this.app.all('/mcp', async (req, res) => {
      console.log(`Received ${req.method} request to /mcp`);
      try {
        const sessionId = req.headers['mcp-session-id'] as string;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports.has(sessionId)) {
          const existingTransport = this.transports.get(sessionId)!;
          if (existingTransport instanceof StreamableHTTPServerTransport) {
            transport = existingTransport;
          } else {
            res.status(400).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: Session exists but uses a different transport protocol',
              },
              id: null,
            });
            return;
          }
        } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            eventStore,
            onsessioninitialized: (sessionId) => {
              console.log(`StreamableHTTP session initialized with ID: ${sessionId}`);
              this.transports.set(sessionId, transport);
            }
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && this.transports.has(sid)) {
              console.log(`Transport closed for session ${sid}, removing from transports map`);
              this.transports.delete(sid);
            }
          };

          const server = this.createMcpServer();
          await server.connect(transport);
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided or invalid initialization request',
            },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // Deprecated SSE Transport (Protocol version 2024-11-05)
    this.app.get('/sse', async (req, res) => {
      console.log('Received GET request to /sse (deprecated SSE transport)');
      try {
        const transport = new SSEServerTransport('/messages', res, {
          allowedHosts: this.options.allowedHosts,
          allowedOrigins: this.options.allowedOrigins,
          enableDnsRebindingProtection: !!this.options.allowedHosts || !!this.options.allowedOrigins
        });
        
        this.transports.set(transport.sessionId, transport);
        
        res.on("close", () => {
          this.transports.delete(transport.sessionId);
        });

        const server = this.createMcpServer();
        await server.connect(transport);
      } catch (error) {
        console.error('Error setting up SSE transport:', error);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      }
    });

    this.app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: sessionId query parameter is required',
          },
          id: null,
        });
        return;
      }

      const existingTransport = this.transports.get(sessionId);
      
      if (!existingTransport) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No transport found for sessionId',
          },
          id: null,
        });
        return;
      }

      if (!(existingTransport instanceof SSEServerTransport)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session exists but uses a different transport protocol',
          },
          id: null,
        });
        return;
      }

      try {
        await existingTransport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error('Error handling SSE message:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });
  }

  public async start(): Promise<void> {
    const port = this.options.port || 3000;
    
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, (error?: any) => {
        if (error) {
          reject(error);
          return;
        }
        
        console.log(`Azure DevOps MCP Remote Server listening on port ${port}`);
        console.log(`Organization: ${this.options.orgName}`);
        console.log(`
==============================================
AZURE DEVOPS MCP REMOTE SERVER

Base URL: http://localhost:${port}
Health Check: http://localhost:${port}/health

SUPPORTED TRANSPORT OPTIONS:

1. Streamable HTTP (Protocol version: 2025-03-26)
   Endpoint: /mcp
   Methods: GET, POST, DELETE
   Usage: 
     - Initialize with POST to /mcp
     - Establish SSE stream with GET to /mcp
     - Send requests with POST to /mcp
     - Terminate session with DELETE to /mcp

2. HTTP + SSE (Protocol version: 2024-11-05)
   Endpoints: /sse (GET) and /messages (POST)
   Usage:
     - Establish SSE stream with GET to /sse
     - Send requests with POST to /messages?sessionId=<id>
==============================================
`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    console.log('Shutting down Azure DevOps MCP Remote Server...');
    
    // Close all active transports
    for (const [sessionId, transport] of this.transports) {
      try {
        console.log(`Closing transport for session ${sessionId}`);
        await transport.close();
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }
    
    this.transports.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('Server shutdown complete');
          resolve();
        });
      });
    }
  }
}