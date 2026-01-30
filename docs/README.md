# @flowmonkey/docs

Documentation wiki for FlowMonkey, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Deployment

### Vercel (Recommended)

1. Connect your repository to Vercel
2. Set the root directory to `packages/docs`
3. Deploy

### Netlify

1. Connect your repository to Netlify
2. Build command: `cd packages/docs && pnpm build`
3. Publish directory: `packages/docs/dist`

### Docker

```bash
# Build image
docker build -t flowmonkey-docs -f packages/docs/Dockerfile .

# Run container
docker run -p 4321:4321 flowmonkey-docs
```

### GitHub Pages

Add to `.github/workflows/docs.yml`:

```yaml
name: Deploy Docs

on:
  push:
    branches: [main]
    paths: ['packages/docs/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm --filter @flowmonkey/docs build
      
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./packages/docs/dist
```

## Structure

```
src/
├── assets/           # Images, logos
├── content/
│   └── docs/         # Documentation pages
│       ├── getting-started/
│       ├── core/
│       ├── handlers/
│       ├── persistence/
│       ├── triggers/
│       ├── advanced/
│       ├── api/
│       ├── deployment/
│       └── testing/
└── styles/           # Custom CSS
```

## Adding Pages

Create `.md` or `.mdx` files in `src/content/docs/`:

```markdown
---
title: My New Page
description: A description for SEO.
---

# My New Page

Content goes here...
```

Update `astro.config.mjs` sidebar to include the new page.

## Customization

- Edit `astro.config.mjs` for site config and navigation
- Edit `src/styles/custom.css` for styling
- Replace `src/assets/mascot.png` with your logo
