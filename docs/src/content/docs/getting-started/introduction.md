---
title: Introduction
description: Learn what FlowMonkey is and why you might want to use it.
---

# Introduction

**FlowMonkey** is a minimal, production-ready workflow execution engine for TypeScript/Node.js. It enables you to define, execute, and manage complex workflows with built-in support for persistence, retries, waiting, and horizontal scaling.

## What is a Workflow Engine?

A workflow engine orchestrates the execution of a series of steps (tasks) in a defined order. Each step can:

- Transform data
- Make external API calls
- Wait for human input
- Branch based on conditions
- Handle errors gracefully

## Why FlowMonkey?

### Stateless by Design

The core engine is completely stateless. All execution state is persisted to a store (memory, PostgreSQL, Redis). This means:

- **Horizontal scaling**: Run multiple engine instances without coordination
- **Durability**: Executions survive process restarts
- **Debuggability**: Full execution history is persisted

### Simple Mental Model

FlowMonkey uses a simple, declarative model:

1. **Flows** define the workflow structure (steps and transitions)
2. **Handlers** execute individual step types
3. **Executions** track the runtime state of a flow instance

### Production Ready

- PostgreSQL persistence for durability
- Redis coordination for distributed locking
- Idempotency support to prevent duplicates
- Timeout handling with auto-cancellation
- Comprehensive error handling

## Use Cases

FlowMonkey is ideal for:

- **Order processing pipelines**
- **Multi-step approval workflows**
- **Data transformation pipelines**
- **Scheduled job orchestration**
- **Human-in-the-loop AI workflows**
- **Event-driven automation**

## Next Steps

- [Installation](/getting-started/installation/) - Get FlowMonkey installed
- [Quick Start](/getting-started/quick-start/) - Build your first workflow
- [Core Concepts](/getting-started/concepts/) - Understand the fundamentals
