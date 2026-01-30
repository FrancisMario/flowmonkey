---
title: Installation
description: How to install FlowMonkey packages.
---

# Installation

FlowMonkey is distributed as a set of npm packages. Install only what you need.

## Core Package

The core package includes the execution engine, types, and an in-memory store for development/testing:

```bash
# Using pnpm (recommended)
pnpm add @flowmonkey/core

# Using npm
npm install @flowmonkey/core

# Using yarn
yarn add @flowmonkey/core
```

## Production Stores

For production deployments, add persistence packages:

```bash
# PostgreSQL persistence (recommended for production)
pnpm add @flowmonkey/postgres

# Redis caching and coordination
pnpm add @flowmonkey/redis
```

## Optional Packages

```bash
# Pre-built handlers (HTTP, delay, transform, etc.)
pnpm add @flowmonkey/handlers

# Background job runner for stateful handlers
pnpm add @flowmonkey/jobs

# HTTP and cron triggers
pnpm add @flowmonkey/triggers
```

## Package Overview

| Package | Description | Required |
|---------|-------------|----------|
| `@flowmonkey/core` | Core engine, types, memory store | ✅ Yes |
| `@flowmonkey/postgres` | PostgreSQL persistence | Production |
| `@flowmonkey/redis` | Redis caching, locking, signaling | Optional |
| `@flowmonkey/handlers` | Pre-built step handlers | Optional |
| `@flowmonkey/jobs` | Background job runner | Optional |
| `@flowmonkey/triggers` | HTTP/cron triggers | Optional |

## Requirements

- **Node.js**: 20 or higher
- **TypeScript**: 5.0+ (recommended)
- **PostgreSQL**: 14+ (if using `@flowmonkey/postgres`)
- **Redis**: 6+ (if using `@flowmonkey/redis`)

## TypeScript Setup

FlowMonkey is written in TypeScript and ships with full type definitions. No additional `@types` packages are needed.

Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Next Steps

- [Quick Start](/getting-started/quick-start/) - Build your first workflow
- [Core Concepts](/getting-started/concepts/) - Understand the fundamentals
