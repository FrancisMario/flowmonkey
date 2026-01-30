FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/docs/package.json ./packages/docs/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @flowmonkey/docs

# Copy docs source
COPY packages/docs ./packages/docs
COPY assets ./assets

# Build
RUN pnpm --filter @flowmonkey/docs build

# Production image with static server
FROM nginx:alpine

COPY --from=builder /app/packages/docs/dist /usr/share/nginx/html

# Nginx config for SPA
RUN echo 'server { \
    listen 4321; \
    root /usr/share/nginx/html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 4321

CMD ["nginx", "-g", "daemon off;"]
