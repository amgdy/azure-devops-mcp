# Use the official Node.js 20 runtime as base image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy the compiled JavaScript files
COPY dist/ ./dist/

# Create a non-root user
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

# Expose the port that the app runs on
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Define the command to run the application in remote mode
# The organization name must be provided via environment variable
CMD ["sh", "-c", "node dist/index.js ${AZURE_DEVOPS_ORG} --remote --port 3000"]