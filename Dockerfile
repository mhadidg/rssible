FROM node:20-slim

# Install wrangler CLI
RUN npm install -g wrangler

WORKDIR /app

# Copy source
COPY . .

# Expose port
EXPOSE 8787

# Default command: preview mode (hot reload off)
CMD ["wrangler", "dev", "--local", "--port", "8787"]
