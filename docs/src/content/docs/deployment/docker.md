---
title: Docker Deployment
description: Deploying FlowMonkey with Docker.
---

# Docker Deployment

Deploy FlowMonkey using Docker containers.

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/postgres/package.json ./packages/postgres/
COPY packages/redis/package.json ./packages/redis/
COPY packages/handlers/package.json ./packages/handlers/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/triggers/package.json ./packages/triggers/

RUN pnpm install --frozen-lockfile

# Build
COPY . .
RUN pnpm build

# Production image
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
```

## Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  engine:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://postgres:password@postgres:5432/flowmonkey
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  job-runner:
    build: .
    command: ["node", "packages/jobs/dist/runner.js"]
    environment:
      DATABASE_URL: postgres://postgres:password@postgres:5432/flowmonkey
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: flowmonkey
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

## Running

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f engine

# Scale engine instances
docker-compose up -d --scale engine=3

# Stop
docker-compose down
```

## Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flowmonkey-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: flowmonkey-engine
  template:
    metadata:
      labels:
        app: flowmonkey-engine
    spec:
      containers:
        - name: engine
          image: your-registry/flowmonkey:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: flowmonkey-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: flowmonkey-secrets
                  key: redis-url
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: flowmonkey-engine
spec:
  selector:
    app: flowmonkey-engine
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

## CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build and push
        run: |
          docker build -t your-registry/flowmonkey:${{ github.sha }} .
          docker push your-registry/flowmonkey:${{ github.sha }}
      
      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/flowmonkey-engine \
            engine=your-registry/flowmonkey:${{ github.sha }}
```
