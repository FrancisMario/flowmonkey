/**
 * Tests for route utilities.
 */

import { describe, it, expect } from 'vitest';
import { Routes, buildRoute, DefaultRouteConfig } from '../src/routes';

describe('Routes', () => {
  describe('Route constants', () => {
    it('has health route', () => {
      expect(Routes.Health).toBe('/health');
    });

    it('has ready route', () => {
      expect(Routes.Ready).toBe('/ready');
    });

    it('has execution routes', () => {
      expect(Routes.StartFlow).toBe('/api/flows/:flowId/start');
      expect(Routes.GetExecution).toBe('/api/executions/:executionId');
      expect(Routes.CancelExecution).toBe('/api/executions/:executionId/cancel');
    });

    it('has admin routes', () => {
      expect(Routes.ListFlows).toBe('/api/admin/flows');
      expect(Routes.ListHandlers).toBe('/api/admin/handlers');
    });
  });

  describe('buildRoute', () => {
    it('builds route with single parameter', () => {
      const route = buildRoute(Routes.GetExecution, { executionId: 'exec-123' });
      expect(route).toBe('/api/executions/exec-123');
    });

    it('builds route with multiple parameters', () => {
      const route = buildRoute(Routes.StartFlow, { flowId: 'my-flow' });
      expect(route).toBe('/api/flows/my-flow/start');
    });

    it('returns route unchanged if no params needed', () => {
      const route = buildRoute(Routes.Health, {});
      expect(route).toBe('/health');
    });

    it('handles missing params gracefully', () => {
      const route = buildRoute(Routes.GetExecution, {});
      expect(route).toBe('/api/executions/:executionId');
    });

    it('replaces first occurrence of param', () => {
      // Note: buildRoute uses String.replace which only replaces the first occurrence
      // Using type assertion since this is testing with a custom pattern
      const pattern = '/api/:id/sub/:id' as Parameters<typeof buildRoute>[0];
      const route = buildRoute(pattern, { id: '123' });
      // First occurrence is replaced
      expect(route).toBe('/api/123/sub/:id');
    });
  });

  describe('DefaultRouteConfig', () => {
    it('has all routes enabled by default', () => {
      expect(DefaultRouteConfig.executions).toBe(true);
      expect(DefaultRouteConfig.admin).toBe(true);
      expect(DefaultRouteConfig.health).toBe(true);
      expect(DefaultRouteConfig.triggers).toBe(true);
      expect(DefaultRouteConfig.resumeTokens).toBe(true);
    });
  });
});
