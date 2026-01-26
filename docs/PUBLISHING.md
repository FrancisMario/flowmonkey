# Publishing Guide

This document describes how to publish FlowMonkey packages to npm.

## Prerequisites

1. npm account with access to the `@flowmonkey` organization
2. Logged in to npm: `npm login`
3. All tests passing: `pnpm test`
4. All packages built: `pnpm build`

## Package Overview

| Package | Description |
|---------|-------------|
| `@flowmonkey/core` | Core execution engine, types, and interfaces |
| `@flowmonkey/handlers` | Built-in step handlers (HTTP, transform, delay) |
| `@flowmonkey/postgres` | PostgreSQL storage adapters |
| `@flowmonkey/redis` | Redis distributed coordination |
| `@flowmonkey/jobs` | Background job runner |
| `@flowmonkey/triggers` | HTTP and cron triggers |

## Version Management

All packages share the same version number for simplicity.

### Bump versions

```bash
# Patch release (1.0.0 -> 1.0.1)
pnpm version:patch

# Minor release (1.0.0 -> 1.1.0)
pnpm version:minor

# Major release (1.0.0 -> 2.0.0)
pnpm version:major
```

## Publishing

### Dry run (recommended first)

```bash
pnpm release:dry
```

This builds, tests, and simulates publishing without actually uploading to npm.

### Publish for real

```bash
pnpm release
```

This will:
1. Build all packages
2. Run all tests
3. Publish each package to npm with public access

### Manual publishing

If you need to publish a single package:

```bash
cd packages/core
pnpm build
npm publish --access public
```

## Release Checklist

Before publishing a new version:

- [ ] All tests pass (`pnpm test`)
- [ ] TypeScript compiles (`pnpm typecheck`)
- [ ] Build succeeds (`pnpm build`)
- [ ] CHANGELOG updated (if you maintain one)
- [ ] Version bumped in all packages
- [ ] Dry run succeeds (`pnpm release:dry`)
- [ ] Git tag created and pushed

## Post-Release

After publishing:

1. Create a git tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. Create a GitHub release with release notes

3. Announce the release if appropriate

## Troubleshooting

### "You must be logged in to publish packages"

Run `npm login` and authenticate with your npm credentials.

### "You do not have permission to publish"

Ensure your npm account has been added to the `@flowmonkey` organization with publish permissions.

### "Package name too similar to existing package"

This shouldn't happen with a scoped package, but if it does, check that the package name is exactly `@flowmonkey/package-name`.

### "Cannot publish over existing version"

You cannot overwrite a published version. Bump the version number and try again.

## CI/CD Publishing

For automated publishing via GitHub Actions, create a workflow like:

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 9
          
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test
      - run: pnpm -r publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Store your npm token as `NPM_TOKEN` in GitHub repository secrets.
