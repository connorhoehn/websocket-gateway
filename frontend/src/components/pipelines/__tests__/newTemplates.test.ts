// frontend/src/components/pipelines/__tests__/newTemplates.test.ts
//
// Validates the four new domain templates added to the pipeline templates
// gallery — Incident Response, Code Review, Content Moderation (Publish Gate),
// and Customer Support Triage. Each is built with a stub user id, walked
// through `validatePipeline`, and asserted to produce zero errors. Warnings
// are tolerated (they're advisory lints).
//
// Framework: Vitest. See frontend/vite.config.ts.

import { describe, test, expect } from 'vitest';
import { pipelineTemplates } from '../templates';
import { validatePipeline } from '../validation/validatePipeline';

const NEW_TEMPLATE_IDS = [
  'incident-response',
  'code-review',
  'content-moderation-publish-gate',
  'support-triage',
] as const;

describe('new domain pipeline templates', () => {
  test.each(NEW_TEMPLATE_IDS)(
    '%s is registered in the templates gallery',
    (id) => {
      const template = pipelineTemplates.find((t) => t.id === id);
      expect(template).toBeDefined();
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
      expect(template!.icon.length).toBeGreaterThan(0);
      expect(Array.isArray(template!.tags)).toBe(true);
      expect(template!.tags.length).toBeGreaterThan(0);
    },
  );

  test.each(NEW_TEMPLATE_IDS)(
    '%s builds a PipelineDefinition with zero validation errors',
    (id) => {
      const template = pipelineTemplates.find((t) => t.id === id);
      expect(template, `template ${id} not found`).toBeDefined();

      const def = template!.build('test-user');
      const result = validatePipeline(def);

      // Surface error messages on failure for fast diagnosis.
      if (result.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.error(`[${id}] validation errors:`, result.errors);
      }
      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);
      expect(result.canPublish).toBe(true);

      // Sanity-check graph topology.
      expect(def.nodes.length).toBeGreaterThan(0);
      expect(def.edges.length).toBeGreaterThan(0);

      // Exactly one trigger.
      const triggers = def.nodes.filter((n) => n.type === 'trigger');
      expect(triggers).toHaveLength(1);

      // Every Approval has at least one approver placeholder.
      for (const node of def.nodes) {
        if (node.data.type === 'approval') {
          expect(node.data.approvers.length).toBeGreaterThan(0);
        }
      }

      // Every Fork has a matching Join (validator's lintForkWithoutMatchingJoin
      // is a warning, but our templates are intentional so no Fork should be
      // dangling).
      const forkCount = def.nodes.filter((n) => n.type === 'fork').length;
      const joinCount = def.nodes.filter((n) => n.type === 'join').length;
      expect(joinCount).toBeGreaterThanOrEqual(forkCount);
    },
  );
});
