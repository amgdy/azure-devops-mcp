# Production stage
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcpserver -u 1001

# Copy package files
COPY package*.json ./

# Copy pre-built application and node_modules
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/

# Create entrypoint script to handle environment variable substitution
RUN printf '#!/bin/sh\nif [ -z "$ADO_ORGANIZATION" ]; then\n  echo "ADO_ORGANIZATION environment variable is required"\n  exit 1\nfi\n\nexec node dist/index.js "$ADO_ORGANIZATION" --http\n' > /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

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

# Use the entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]