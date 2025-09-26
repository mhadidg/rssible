FROM node:22-slim

WORKDIR /app
COPY package.json ./

# Install wrangler version from package.json
RUN set -eux; \
    VER="$(npm pkg get devDependencies.wrangler | tr -d '"')"; \
    npm install -g "wrangler@${VER}"

COPY worker.js wrangler.toml ./
COPY public ./public

EXPOSE 8787
CMD ["wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]
