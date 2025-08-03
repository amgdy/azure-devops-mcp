# Use Node.js 20 Alpine as base image for smaller size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcpserver -u 1001

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY dist/ ./dist/

# Change ownership to non-root user
RUN chown -R mcpserver:nodejs /app
USER mcpserver

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: 3000, path: '/health', method: 'GET' }; const req = http.request(options, (res) => { if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } }); req.on('error', () => { process.exit(1); }); req.end();"

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV MCP_HTTP_MODE=true

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the HTTP server - organization must be provided via ADO_ORGANIZATION environment variable
CMD ["sh", "-c", "node dist/index.js \"${ADO_ORGANIZATION:-contoso}\" --http"]