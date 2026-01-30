import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'FlowMonkey',
      logo: {
        src: './src/assets/mascot.png',
        alt: 'FlowMonkey Logo',
      },
      social: {
        github: 'https://github.com/francismario/flowmonkey',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Core Concepts', slug: 'getting-started/concepts' },
          ],
        },
        {
          label: 'Core',
          items: [
            { label: 'Engine', slug: 'core/engine' },
            { label: 'Flows', slug: 'core/flows' },
            { label: 'Steps', slug: 'core/steps' },
            { label: 'Input Selectors', slug: 'core/input-selectors' },
            { label: 'Transitions', slug: 'core/transitions' },
            { label: 'Execution Lifecycle', slug: 'core/execution-lifecycle' },
          ],
        },
        {
          label: 'Handlers',
          items: [
            { label: 'Overview', slug: 'handlers/overview' },
            { label: 'HTTP Handler', slug: 'handlers/http' },
            { label: 'Delay Handler', slug: 'handlers/delay' },
            { label: 'Transform Handler', slug: 'handlers/transform' },
            { label: 'Custom Handlers', slug: 'handlers/custom' },
          ],
        },
        {
          label: 'Persistence',
          items: [
            { label: 'State Store Interface', slug: 'persistence/state-store' },
            { label: 'Memory Store', slug: 'persistence/memory-store' },
            { label: 'PostgreSQL Store', slug: 'persistence/postgres' },
            { label: 'Redis Coordination', slug: 'persistence/redis' },
          ],
        },
        {
          label: 'Triggers',
          items: [
            { label: 'Overview', slug: 'triggers/overview' },
            { label: 'HTTP Triggers', slug: 'triggers/http' },
            { label: 'Cron Triggers', slug: 'triggers/cron' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Idempotency', slug: 'advanced/idempotency' },
            { label: 'Timeouts', slug: 'advanced/timeouts' },
            { label: 'Cancellation', slug: 'advanced/cancellation' },
            { label: 'Waiting & Resume', slug: 'advanced/waiting-resume' },
            { label: 'Error Handling', slug: 'advanced/error-handling' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Engine API', slug: 'api/engine' },
            { label: 'Result Helpers', slug: 'api/result' },
            { label: 'Types', slug: 'api/types' },
            { label: 'Interfaces', slug: 'api/interfaces' },
          ],
        },
        {
          label: 'Deployment',
          items: [
            { label: 'Production Setup', slug: 'deployment/production' },
            { label: 'Docker', slug: 'deployment/docker' },
          ],
        },
        {
          label: 'Testing',
          items: [
            { label: 'Test Harness', slug: 'testing/harness' },
            { label: 'Integration Tests', slug: 'testing/integration' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
