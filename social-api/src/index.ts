import { createApp } from './app';
import { createScheduleEvaluator } from './services/scheduleEvaluator';
import { stubPipelineStore } from './routes/pipelineDefinitions';

const port = process.env.PORT ?? '3001';

if (!process.env.COGNITO_REGION || !process.env.COGNITO_USER_POOL_ID) {
  console.error('FATAL: COGNITO_REGION and COGNITO_USER_POOL_ID must be set');
  process.exit(1);
}

const app = createApp();
const server = app.listen(Number(port), () => {
  console.log(`social-api listening on port ${port}`);
});

// ---------------------------------------------------------------------------
// Schedule evaluator — fires pipelines whose triggerBinding.event === 'schedule'
// on their cron expression. Phase 1: logs only; Phase 4 will call the pipeline
// resource to produce a run.
// ---------------------------------------------------------------------------

interface ScheduledPipelineShape {
  id?: unknown;
  status?: unknown;
  triggerBinding?: { event?: unknown; schedule?: unknown };
}

const scheduler = createScheduleEvaluator({
  listPipelines: () => {
    const out: Array<{ id: string; status: string; triggerBinding?: { event: string; schedule?: string } }> = [];
    for (const raw of stubPipelineStore.allPipelines()) {
      const p = raw as ScheduledPipelineShape;
      if (typeof p?.id !== 'string' || typeof p.status !== 'string') continue;
      const tb = p.triggerBinding;
      const triggerBinding = tb && typeof tb.event === 'string'
        ? {
            event: tb.event,
            schedule: typeof tb.schedule === 'string' ? tb.schedule : undefined,
          }
        : undefined;
      out.push({ id: p.id, status: p.status, triggerBinding });
    }
    return out;
  },
  trigger: async (pipelineId, payload) => {
    // Phase 1: log only. Phase 4 will create a pipeline run via ResourceRouter.
    console.log('[scheduler] firing', pipelineId, payload);
  },
});
scheduler.start();

// Graceful shutdown — stop the timer so the process can exit cleanly.
function shutdown(signal: string): void {
  console.log(`[social-api] received ${signal}, shutting down`);
  scheduler.stop();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
