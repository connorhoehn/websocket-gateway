import { Router } from 'express';
import { profilesRouter } from './profiles';
import { socialRouter } from './social';
import { groupsRouter } from './groups';
import { groupMembersRouter } from './group-members';
import { roomsRouter } from './rooms';
import { groupRoomsRouter } from './group-rooms';
import { roomMembersRouter, myRoomsRouter } from './room-members';
import { postsRouter, userPostsRouter } from './posts';
import { commentsRouter } from './comments';
import { postLikesRouter, commentLikesRouter } from './likes';
import { reactionsRouter } from './reactions';
import { activityRouter } from './activity';
import { documentCommentsRouter } from './documentComments';
import { sectionReviewsRouter, documentReviewsRouter, myReviewsRouter } from './sectionReviews';
import { sectionItemsRouter, myItemsRouter } from './sectionItems';
import { documentImportExportRouter } from './documentImportExport';
import { videoSessionsRouter } from './videoSessions';
import { pipelineMetricsRouter, observabilityRouter } from './pipelineMetrics';
import { pipelineDefinitionsRouter } from './pipelineDefinitions';
import { pipelineHealthRouter } from './pipelineHealth';
import {
  pipelineTriggersRouter,
  pipelineApprovalsRouter,
  pipelineActiveRunsRouter,
  pipelineCancelRouter,
} from './pipelineTriggers';
import { pipelineValidationRouter } from './pipelineValidation';

const router = Router();

router.use('/profiles', profilesRouter);
router.use('/social', socialRouter);
router.use('/groups', groupsRouter);
router.use('/groups/:groupId', groupMembersRouter);
router.use('/groups/:groupId/rooms', groupRoomsRouter);
router.use('/rooms', myRoomsRouter);
router.use('/rooms', roomsRouter);
router.use('/rooms/:roomId', roomMembersRouter);
router.use('/rooms/:roomId/posts', postsRouter);
router.use('/posts', userPostsRouter);
router.use('/rooms/:roomId/posts/:postId/comments', commentsRouter);
router.use('/rooms/:roomId/posts/:postId/likes', postLikesRouter);
router.use('/rooms/:roomId/posts/:postId/comments/:commentId/likes', commentLikesRouter);
router.use('/rooms/:roomId/posts/:postId', reactionsRouter);
router.use('/activity', activityRouter);
router.use('/documents', documentCommentsRouter);
router.use('/documents/:documentId/sections/:sectionId/reviews', sectionReviewsRouter);
router.use('/documents/:documentId/reviews', documentReviewsRouter);
router.use('/reviews', myReviewsRouter);
router.use('/documents/:documentId/sections/:sectionId/items', sectionItemsRouter);
router.use('/items', myItemsRouter);
router.use('/documents/:documentId', documentImportExportRouter);
router.use('/video', videoSessionsRouter);
// Mount metrics (static segment) BEFORE defs — Express resolves mounts in
// registration order. A hypothetical `/pipelines` mount with a `:pipelineId`
// param would otherwise swallow `/pipelines/metrics`.
router.use('/pipelines/metrics', pipelineMetricsRouter);
router.use('/pipelines/defs', pipelineDefinitionsRouter);
// Health introspection — same precedence rule as `/metrics` and `/defs`:
// register the static segment BEFORE any `:pipelineId` mount.
router.use('/pipelines/health', pipelineHealthRouter);
// Validation — POST /api/pipelines/validate. Static segment, must precede
// the `:pipelineId` mount below for the same reason as `/metrics`/`/defs`.
router.use('/pipelines/validate', pipelineValidationRouter);
// Active-runs listing — GET /api/pipelines/runs/active. Static segment,
// must precede the `:pipelineId` mount below so `runs` doesn't get
// interpreted as a pipelineId.
router.use('/pipelines/runs/active', pipelineActiveRunsRouter);
// Per-pipeline run trigger. Mounted AFTER the static `/metrics`, `/defs`,
// `/health`, `/validate`, and `/runs/active` segments so their specific
// paths match first (Express resolves mounts in registration order — a
// `:pipelineId` mount would otherwise swallow them).
router.use('/pipelines/:pipelineId/runs', pipelineTriggersRouter);
// Cancel — POST /api/pipelines/:runId/cancel. Mounted at the same level
// as approvals; both are run-scoped (not pipeline-scoped).
router.use('/pipelines/:runId/cancel', pipelineCancelRouter);
// Approvals — POST /api/pipelines/:runId/approvals (per PIPELINES_PLAN §17.10).
router.use('/pipelines/:runId/approvals', pipelineApprovalsRouter);
// Observability — GET /api/observability/dashboard, /api/observability/metrics.
router.use('/observability', observabilityRouter);

export default router;
