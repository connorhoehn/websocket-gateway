// frontend/src/components/pipelines/templates/index.ts
//
// Pipeline templates gallery — prebuilt PipelineDefinition shapes users can
// spawn with one click from the TemplatesModal. Each template's `build()`
// returns a *fresh* PipelineDefinition with newly-minted IDs and sensible
// layout coordinates (280px horizontal, 160px vertical spacing for branches).
//
// Templates are returned unsaved — the caller is responsible for invoking
// savePipeline(def) so the gallery can be consumed by different UIs (e.g.
// quick-spawn, programmatic seeding) without tight coupling to localStorage.

import type {
  ActionNodeData,
  ApprovalNodeData,
  ConditionNodeData,
  ForkNodeData,
  JoinNodeData,
  LLMNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TransformNodeData,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  build(createdBy: string): PipelineDefinition;
}

// ---------------------------------------------------------------------------
// Layout helpers — consistent 280px horizontal / 160px vertical spacing
// ---------------------------------------------------------------------------

const COL_W = 280;
const ROW_H = 160;
const BASE_X = 40;
const BASE_Y = 200;

function col(n: number): number {
  return BASE_X + n * COL_W;
}

function row(n: number): number {
  return BASE_Y + n * ROW_H;
}

function edge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string = 'in',
): PipelineEdge {
  return {
    id: crypto.randomUUID(),
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

// ---------------------------------------------------------------------------
// 1. Document summary
// ---------------------------------------------------------------------------

function buildDocumentSummary(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const llmId = crypto.randomUUID();
  const postCommentId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'document.finalize',
  };

  const llmData: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Summarize the following document in 2-3 concise sentences.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.3,
    maxTokens: 512,
    streaming: true,
  };

  const postCommentData: ActionNodeData = {
    type: 'action',
    actionType: 'post-comment',
    config: { body: `{{context.steps.${llmId}.response}}` },
    idempotent: true,
    onError: 'fail-run',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,     type: 'trigger', position: { x: col(0), y: row(0) }, data: triggerData },
    { id: llmId,         type: 'llm',     position: { x: col(1), y: row(0) }, data: llmData },
    { id: postCommentId, type: 'action',  position: { x: col(2), y: row(0) }, data: postCommentData },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', llmId),
    edge(llmId, 'out', postCommentId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Document Summary',
    description: 'Summarize a finalized document and post the summary as a comment.',
    icon: '📄',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'document.finalize' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 2. Meeting notes assistant — Fork → two LLM/Action branches → Join
// ---------------------------------------------------------------------------

function buildMeetingNotesAssistant(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const forkId = crypto.randomUUID();
  const actionItemsLlmId = crypto.randomUUID();
  const createTasksId = crypto.randomUUID();
  const summaryLlmId = crypto.randomUUID();
  const notifyTeamId = crypto.randomUUID();
  const joinId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'document.finalize',
    documentTypeId: 'meeting-notes',
  };

  const forkData: ForkNodeData = {
    type: 'fork',
    branchCount: 2,
    branchLabels: ['action-items', 'summary'],
  };

  const actionItemsLlm: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Extract action items from these meeting notes. Respond as a JSON array of {assignee, task, dueDate?}.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.2,
    maxTokens: 1024,
    streaming: false,
  };

  const createTasks: ActionNodeData = {
    type: 'action',
    actionType: 'update-document',
    config: {
      field: 'tasks',
      value: `{{context.steps.${actionItemsLlmId}.response}}`,
    },
    idempotent: true,
    onError: 'route-error',
  };

  const summaryLlm: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Write a short team-friendly summary of this meeting.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.4,
    maxTokens: 512,
    streaming: true,
  };

  const notifyTeam: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {
      channel: 'team',
      message: `Meeting summary: {{context.steps.${summaryLlmId}.response}}`,
    },
    idempotent: false,
    onError: 'route-error',
  };

  const joinData: JoinNodeData = {
    type: 'join',
    mode: 'all',
    mergeStrategy: 'deep-merge',
  };

  // Layout: branch 0 at row -1 (above), branch 1 at row +1 (below)
  const nodes: PipelineNode[] = [
    { id: triggerId,        type: 'trigger',  position: { x: col(0), y: row(0)        }, data: triggerData },
    { id: forkId,           type: 'fork',     position: { x: col(1), y: row(0)        }, data: forkData },
    { id: actionItemsLlmId, type: 'llm',      position: { x: col(2), y: row(0) - ROW_H / 2 }, data: actionItemsLlm },
    { id: createTasksId,    type: 'action',   position: { x: col(3), y: row(0) - ROW_H / 2 }, data: createTasks },
    { id: summaryLlmId,     type: 'llm',      position: { x: col(2), y: row(0) + ROW_H / 2 }, data: summaryLlm },
    { id: notifyTeamId,     type: 'action',   position: { x: col(3), y: row(0) + ROW_H / 2 }, data: notifyTeam },
    { id: joinId,           type: 'join',     position: { x: col(4), y: row(0)        }, data: joinData },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', forkId),
    edge(forkId, 'branch-0', actionItemsLlmId),
    edge(actionItemsLlmId, 'out', createTasksId),
    edge(createTasksId, 'out', joinId, 'in-0'),
    edge(forkId, 'branch-1', summaryLlmId),
    edge(summaryLlmId, 'out', notifyTeamId),
    edge(notifyTeamId, 'out', joinId, 'in-1'),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Meeting Notes Assistant',
    description: 'Extract action items and send a summary in parallel when meeting notes are finalized.',
    icon: '📝',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'document.finalize', documentTypeId: 'meeting-notes' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 3. Content moderation — classify → condition → (post | flag → approval → ...)
// ---------------------------------------------------------------------------

function buildContentModeration(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const classifyId = crypto.randomUUID();
  const safeConditionId = crypto.randomUUID();
  const postSafeId = crypto.randomUUID();
  const flagId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const approvedConditionId = crypto.randomUUID();
  const postApprovedId = crypto.randomUUID();
  const deleteId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'document.comment',
  };

  const classify: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Classify the safety of this content. Respond with JSON {"safe": boolean, "reason": string}.',
    userPromptTemplate: '{{context.commentBody}}',
    temperature: 0,
    maxTokens: 128,
    streaming: false,
  };

  const safeCondition: ConditionNodeData = {
    type: 'condition',
    expression: `context.steps.${classifyId}.output.safe === true`,
    label: 'Safe?',
  };

  const postSafe: ActionNodeData = {
    type: 'action',
    actionType: 'post-comment',
    config: { body: '{{context.commentBody}}' },
    idempotent: true,
    onError: 'fail-run',
  };

  const flag: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {
      channel: 'moderation',
      message: `Flagged comment: {{context.steps.${classifyId}.output.reason}}`,
    },
    idempotent: true,
    onError: 'fail-run',
  };

  const approval: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'role', value: 'moderator' }],
    requiredCount: 1,
    timeoutMs: 24 * 60 * 60 * 1000,
    timeoutAction: 'reject',
    message: 'This comment was flagged by the safety classifier. Approve to post, reject to delete.',
  };

  const approvedCondition: ConditionNodeData = {
    type: 'condition',
    expression: `context.steps.${approvalId}.output.decision === 'approve'`,
    label: 'Approved?',
  };

  const postApproved: ActionNodeData = {
    type: 'action',
    actionType: 'post-comment',
    config: { body: '{{context.commentBody}}' },
    idempotent: true,
    onError: 'fail-run',
  };

  const del: ActionNodeData = {
    type: 'action',
    actionType: 'update-document',
    config: { field: 'commentStatus', value: 'deleted' },
    idempotent: true,
    onError: 'fail-run',
  };

  // Layout: safe path row 0 upper, flagged path row 0 lower
  const nodes: PipelineNode[] = [
    { id: triggerId,           type: 'trigger',   position: { x: col(0), y: row(0) }, data: triggerData },
    { id: classifyId,          type: 'llm',       position: { x: col(1), y: row(0) }, data: classify },
    { id: safeConditionId,     type: 'condition', position: { x: col(2), y: row(0) }, data: safeCondition },
    { id: postSafeId,          type: 'action',    position: { x: col(3), y: row(0) - ROW_H / 2 }, data: postSafe },
    { id: flagId,              type: 'action',    position: { x: col(3), y: row(0) + ROW_H / 2 }, data: flag },
    { id: approvalId,          type: 'approval',  position: { x: col(4), y: row(0) + ROW_H / 2 }, data: approval },
    { id: approvedConditionId, type: 'condition', position: { x: col(5), y: row(0) + ROW_H / 2 }, data: approvedCondition },
    { id: postApprovedId,      type: 'action',    position: { x: col(6), y: row(0)        }, data: postApproved },
    { id: deleteId,            type: 'action',    position: { x: col(6), y: row(0) + ROW_H }, data: del },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', classifyId),
    edge(classifyId, 'out', safeConditionId),
    edge(safeConditionId, 'true', postSafeId),
    edge(safeConditionId, 'false', flagId),
    edge(flagId, 'out', approvalId),
    edge(approvalId, 'approved', approvedConditionId),
    edge(approvalId, 'rejected', deleteId),
    edge(approvedConditionId, 'true', postApprovedId),
    edge(approvedConditionId, 'false', deleteId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Content Moderation',
    description: 'Classify comments for safety; auto-post safe ones, flag risky ones for human review.',
    icon: '🛡️',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'document.comment' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 4. Auto-tag document
// ---------------------------------------------------------------------------

function buildAutoTagDocument(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const llmId = crypto.randomUUID();
  const transformId = crypto.randomUUID();
  const updateId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'document.finalize',
  };

  const llmData: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Extract 3-8 relevant tags from this document. Respond with a JSON array of lowercase strings, no prose.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.1,
    maxTokens: 256,
    streaming: false,
  };

  const transformData: TransformNodeData = {
    type: 'transform',
    transformType: 'jsonpath',
    expression: `$.steps.${llmId}.response`,
    outputKey: 'tags',
  };

  const updateData: ActionNodeData = {
    type: 'action',
    actionType: 'update-document',
    config: { field: 'tags', value: '{{context.tags}}' },
    idempotent: true,
    onError: 'fail-run',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,   type: 'trigger',   position: { x: col(0), y: row(0) }, data: triggerData },
    { id: llmId,       type: 'llm',       position: { x: col(1), y: row(0) }, data: llmData },
    { id: transformId, type: 'transform', position: { x: col(2), y: row(0) }, data: transformData },
    { id: updateId,    type: 'action',    position: { x: col(3), y: row(0) }, data: updateData },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', llmId),
    edge(llmId, 'out', transformId),
    edge(transformId, 'out', updateId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Auto-tag Document',
    description: 'Extract tags from a finalized document using an LLM and write them back to the document.',
    icon: '🏷️',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'document.finalize' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 5. Approval chain
// ---------------------------------------------------------------------------

function buildApprovalChain(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const teamLeadId = crypto.randomUUID();
  const directorId = crypto.randomUUID();
  const publishId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'document.finalize',
  };

  const teamLead: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'role', value: 'team-lead' }],
    requiredCount: 1,
    timeoutMs: 48 * 60 * 60 * 1000,
    timeoutAction: 'reject',
    message: 'Team-lead approval required before this document can advance.',
  };

  const director: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'role', value: 'director' }],
    requiredCount: 1,
    timeoutMs: 72 * 60 * 60 * 1000,
    timeoutAction: 'reject',
    message: 'Director approval required before publishing.',
  };

  const publish: ActionNodeData = {
    type: 'action',
    actionType: 'update-document',
    config: { field: 'status', value: 'published' },
    idempotent: true,
    onError: 'fail-run',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,  type: 'trigger',  position: { x: col(0), y: row(0) }, data: triggerData },
    { id: teamLeadId, type: 'approval', position: { x: col(1), y: row(0) }, data: teamLead },
    { id: directorId, type: 'approval', position: { x: col(2), y: row(0) }, data: director },
    { id: publishId,  type: 'action',   position: { x: col(3), y: row(0) }, data: publish },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', teamLeadId),
    edge(teamLeadId, 'approved', directorId),
    edge(directorId, 'approved', publishId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Approval Chain',
    description: 'Require team-lead then director approval before publishing a finalized document.',
    icon: '✅',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'document.finalize' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 6. Webhook → translate → publish
// ---------------------------------------------------------------------------

function buildWebhookTranslatePublish(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const extractId = crypto.randomUUID();
  const translateId = crypto.randomUUID();
  const publishId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'webhook',
    webhookPath: '/pipelines/webhooks/translate',
  };

  const extract: TransformNodeData = {
    type: 'transform',
    transformType: 'jsonpath',
    expression: '$.payload.text',
    outputKey: 'sourceText',
  };

  const translate: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Translate the provided text into English. Respond with the translation only, no prose.',
    userPromptTemplate: '{{context.sourceText}}',
    temperature: 0.2,
    maxTokens: 1024,
    streaming: true,
  };

  const publish: ActionNodeData = {
    type: 'action',
    actionType: 'post-comment',
    config: { body: `{{context.steps.${translateId}.response}}` },
    idempotent: true,
    onError: 'route-error',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,   type: 'trigger',   position: { x: col(0), y: row(0) }, data: triggerData },
    { id: extractId,   type: 'transform', position: { x: col(1), y: row(0) }, data: extract },
    { id: translateId, type: 'llm',       position: { x: col(2), y: row(0) }, data: translate },
    { id: publishId,   type: 'action',    position: { x: col(3), y: row(0) }, data: publish },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', extractId),
    edge(extractId, 'out', translateId),
    edge(translateId, 'out', publishId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Webhook → Translate → Publish',
    description: 'Receive a webhook payload, extract text, translate to English, and post it as a comment.',
    icon: '🌐',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'webhook', webhookPath: '/pipelines/webhooks/translate' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 7. Daily document digest — schedule trigger → LLM summary → post comment
// ---------------------------------------------------------------------------

function buildDailyDocumentDigest(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();
  const triggerId = crypto.randomUUID();
  const llmId = crypto.randomUUID();
  const postId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger', triggerType: 'schedule', schedule: '0 9 * * *',
  };
  const llmData: LLMNodeData = {
    type: 'llm', provider: 'anthropic', model: 'claude-sonnet-4-6',
    systemPrompt: 'Summarize all documents updated in the last 24 hours into a concise daily digest with bullet points.',
    userPromptTemplate: '{{context.recentDocuments}}',
    temperature: 0.3, maxTokens: 1024, streaming: false,
  };
  const postData: ActionNodeData = {
    type: 'action', actionType: 'post-comment',
    config: { documentId: 'digest-doc', body: `{{context.steps.${llmId}.response}}` },
    idempotent: true, onError: 'route-error',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId, type: 'trigger', position: { x: col(0), y: row(0) }, data: triggerData },
    { id: llmId,     type: 'llm',     position: { x: col(1), y: row(0) }, data: llmData },
    { id: postId,    type: 'action',  position: { x: col(2), y: row(0) }, data: postData },
  ];
  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', llmId),
    edge(llmId, 'out', postId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Daily Document Digest',
    description: 'Every morning at 9am, summarize the last 24h of document activity and post it to a digest doc.',
    icon: '📰', version: 1, status: 'published', publishedVersion: 1,
    triggerBinding: { event: 'schedule', schedule: '0 9 * * *' },
    nodes, edges, createdAt: now, updatedAt: now, createdBy,
  };
}

// ---------------------------------------------------------------------------
// 8. Auto-tag on creation — submit trigger → LLM → update-document
// ---------------------------------------------------------------------------

function buildAutoTagOnCreation(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();
  const triggerId = crypto.randomUUID();
  const llmId = crypto.randomUUID();
  const updateId = crypto.randomUUID();

  const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'document.submit' };
  const llmData: LLMNodeData = {
    type: 'llm', provider: 'anthropic', model: 'claude-sonnet-4-6',
    systemPrompt: 'Extract 3-6 relevant tags from this newly submitted document. Respond as a JSON array of lowercase strings, no prose.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.2, maxTokens: 256, streaming: false,
  };
  const updateData: ActionNodeData = {
    type: 'action', actionType: 'update-document',
    config: { field: 'tags', value: `{{context.steps.${llmId}.response}}` },
    idempotent: true, onError: 'fail-run',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId, type: 'trigger', position: { x: col(0), y: row(0) }, data: triggerData },
    { id: llmId,     type: 'llm',     position: { x: col(1), y: row(0) }, data: llmData },
    { id: updateId,  type: 'action',  position: { x: col(2), y: row(0) }, data: updateData },
  ];
  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', llmId),
    edge(llmId, 'out', updateId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Auto-tag on Creation',
    description: 'When a new document is submitted, extract tags with an LLM and write them back to the document.',
    icon: '🏷️', version: 1, status: 'published', publishedVersion: 1,
    triggerBinding: { event: 'document.submit' },
    nodes, edges, createdAt: now, updatedAt: now, createdBy,
  };
}

// ---------------------------------------------------------------------------
// 9. PR-style review — finalize → fork(2) → [LLM-review | Approval] → join → notify
// ---------------------------------------------------------------------------

function buildPrStyleReview(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();
  const triggerId = crypto.randomUUID();
  const forkId = crypto.randomUUID();
  const reviewLlmId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const joinId = crypto.randomUUID();
  const notifyId = crypto.randomUUID();

  const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'document.finalize' };
  const forkData: ForkNodeData = {
    type: 'fork', branchCount: 2, branchLabels: ['llm-review', 'human-review'],
  };
  const reviewLlm: LLMNodeData = {
    type: 'llm', provider: 'anthropic', model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a code/document reviewer. Provide a PR-style review with comments, suggestions, and an approval recommendation.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0.3, maxTokens: 1024, streaming: false,
  };
  const approvalData: ApprovalNodeData = {
    type: 'approval', approvers: [{ type: 'role', value: 'reviewer' }],
    requiredCount: 1, timeoutMs: 48 * 60 * 60 * 1000, timeoutAction: 'reject',
    message: 'Please review this document PR-style and approve or reject.',
  };
  const joinData: JoinNodeData = { type: 'join', mode: 'all', mergeStrategy: 'deep-merge' };
  const notifyData: ActionNodeData = {
    type: 'action', actionType: 'notify',
    config: {
      channel: 'reviews',
      message: `Review complete: LLM said {{context.steps.${reviewLlmId}.response}}; reviewer decision: {{context.steps.${approvalId}.output.decision}}`,
    },
    idempotent: false, onError: 'route-error',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,   type: 'trigger',  position: { x: col(0), y: row(0) },              data: triggerData },
    { id: forkId,      type: 'fork',     position: { x: col(1), y: row(0) },              data: forkData },
    { id: reviewLlmId, type: 'llm',      position: { x: col(2), y: row(0) - ROW_H / 2 }, data: reviewLlm },
    { id: approvalId,  type: 'approval', position: { x: col(2), y: row(0) + ROW_H / 2 }, data: approvalData },
    { id: joinId,      type: 'join',     position: { x: col(3), y: row(0) },              data: joinData },
    { id: notifyId,    type: 'action',   position: { x: col(4), y: row(0) },              data: notifyData },
  ];
  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', forkId),
    edge(forkId, 'branch-0', reviewLlmId),
    edge(reviewLlmId, 'out', joinId, 'in-0'),
    edge(forkId, 'branch-1', approvalId),
    edge(approvalId, 'approved', joinId, 'in-1'),
    edge(joinId, 'out', notifyId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'PR-style Review',
    description: 'Finalize a document, run an LLM review and human approval in parallel, then notify when both complete.',
    icon: '🔍', version: 1, status: 'published', publishedVersion: 1,
    triggerBinding: { event: 'document.finalize' },
    nodes, edges, createdAt: now, updatedAt: now, createdBy,
  };
}

// ---------------------------------------------------------------------------
// 10. Incident response — webhook → classify → condition → page+approval | ticket
// ---------------------------------------------------------------------------

function buildIncidentResponse(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const classifyId = crypto.randomUUID();
  const conditionId = crypto.randomUUID();
  const pageOnCallId = crypto.randomUUID();
  const postMortemApprovalId = crypto.randomUUID();
  const fileTicketId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'webhook',
    webhookPath: '/pipelines/webhooks/incident',
  };

  const classify: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are an incident triage assistant. Read the alert payload (PagerDuty/Opsgenie shape) and respond with strict JSON {"severity": "critical"|"high"|"medium"|"low", "summary": string}. No prose.',
    userPromptTemplate: '{{context.payload}}',
    temperature: 0,
    maxTokens: 256,
    streaming: false,
  };

  const condition: ConditionNodeData = {
    type: 'condition',
    expression: `context.steps.${classifyId}.output.severity === 'critical'`,
    label: 'Critical?',
  };

  const pageOnCall: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {
      channel: 'on-call',
      message: `CRITICAL incident: {{context.steps.${classifyId}.output.summary}}`,
    },
    idempotent: false,
    onError: 'fail-run',
  };

  const postMortemApproval: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'role', value: 'incident-commander' }],
    requiredCount: 1,
    timeoutMs: 24 * 60 * 60 * 1000,
    timeoutAction: 'escalate',
    message:
      'Critical incident paged. Please acknowledge and assign a post-mortem owner.',
  };

  const fileTicket: ActionNodeData = {
    type: 'action',
    actionType: 'webhook',
    config: {
      url: 'https://tickets.example.com/api/incidents',
      method: 'POST',
      body: {
        severity: `{{context.steps.${classifyId}.output.severity}}`,
        summary: `{{context.steps.${classifyId}.output.summary}}`,
      },
    },
    idempotent: true,
    onError: 'route-error',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,             type: 'trigger',   position: { x: col(0), y: row(0)              }, data: triggerData },
    { id: classifyId,            type: 'llm',       position: { x: col(1), y: row(0)              }, data: classify },
    { id: conditionId,           type: 'condition', position: { x: col(2), y: row(0)              }, data: condition },
    { id: pageOnCallId,          type: 'action',    position: { x: col(3), y: row(0) - ROW_H / 2 }, data: pageOnCall },
    { id: postMortemApprovalId,  type: 'approval',  position: { x: col(4), y: row(0) - ROW_H / 2 }, data: postMortemApproval },
    { id: fileTicketId,          type: 'action',    position: { x: col(3), y: row(0) + ROW_H / 2 }, data: fileTicket },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', classifyId),
    edge(classifyId, 'out', conditionId),
    edge(conditionId, 'true', pageOnCallId),
    edge(pageOnCallId, 'out', postMortemApprovalId),
    edge(conditionId, 'false', fileTicketId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Incident Response',
    description:
      'Webhook from PagerDuty/Opsgenie triages severity; critical alerts page on-call and request a post-mortem owner, others file a ticket.',
    icon: '🚨',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'webhook', webhookPath: '/pipelines/webhooks/incident' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 11. Code review — webhook (PR) → summarize → fork(3) → join → synthesize → comment
// ---------------------------------------------------------------------------

function buildCodeReview(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const summarizeId = crypto.randomUUID();
  const forkId = crypto.randomUUID();
  const securityId = crypto.randomUUID();
  const styleId = crypto.randomUUID();
  const coverageId = crypto.randomUUID();
  const joinId = crypto.randomUUID();
  const synthesizeId = crypto.randomUUID();
  const postCommentId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'webhook',
    webhookPath: '/pipelines/webhooks/github-pr',
  };

  const summarize: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a senior code reviewer. Read the GitHub pull-request payload and produce a brief, structured summary of the diff (files touched, scope, intent). No prose preface.',
    userPromptTemplate: '{{context.payload.pull_request}}',
    temperature: 0.2,
    maxTokens: 768,
    streaming: false,
  };

  const forkData: ForkNodeData = {
    type: 'fork',
    branchCount: 3,
    branchLabels: ['security', 'style', 'tests'],
  };

  const security: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a security auditor. Review this diff for vulnerabilities (injection, secrets, authz, unsafe deserialization, SSRF). Output JSON {"findings": [{"severity": "high"|"med"|"low", "file": string, "issue": string}]}.',
    userPromptTemplate: `{{context.payload.pull_request.diff}}\n\nSummary: {{context.steps.${summarizeId}.response}}`,
    temperature: 0.1,
    maxTokens: 1024,
    streaming: false,
  };

  const style: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a code-style reviewer. Flag naming, structure, readability, and idiom issues. Output JSON {"findings": [{"file": string, "line": number?, "issue": string}]}.',
    userPromptTemplate: `{{context.payload.pull_request.diff}}\n\nSummary: {{context.steps.${summarizeId}.response}}`,
    temperature: 0.2,
    maxTokens: 1024,
    streaming: false,
  };

  const coverage: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a test-coverage reviewer. Identify untested branches, missing edge-case tests, and risky changes lacking tests. Output JSON {"gaps": [{"file": string, "concern": string}]}.',
    userPromptTemplate: `{{context.payload.pull_request.diff}}\n\nSummary: {{context.steps.${summarizeId}.response}}`,
    temperature: 0.1,
    maxTokens: 1024,
    streaming: false,
  };

  const joinData: JoinNodeData = {
    type: 'join',
    mode: 'all',
    mergeStrategy: 'array-collect',
  };

  const synthesize: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a lead reviewer. Combine the security, style, and test-coverage findings into a single PR comment in markdown with sections, prioritized actions, and a final approve/request-changes recommendation.',
    userPromptTemplate:
      `Security: {{context.steps.${securityId}.response}}\n\nStyle: {{context.steps.${styleId}.response}}\n\nCoverage: {{context.steps.${coverageId}.response}}`,
    temperature: 0.3,
    maxTokens: 1536,
    streaming: true,
  };

  const postComment: ActionNodeData = {
    type: 'action',
    actionType: 'webhook',
    config: {
      url: '{{context.payload.pull_request.comments_url}}',
      method: 'POST',
      body: { body: `{{context.steps.${synthesizeId}.response}}` },
    },
    idempotent: false,
    onError: 'route-error',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,     type: 'trigger',  position: { x: col(0), y: row(0)              }, data: triggerData },
    { id: summarizeId,   type: 'llm',      position: { x: col(1), y: row(0)              }, data: summarize },
    { id: forkId,        type: 'fork',     position: { x: col(2), y: row(0)              }, data: forkData },
    { id: securityId,    type: 'llm',      position: { x: col(3), y: row(0) - ROW_H      }, data: security },
    { id: styleId,       type: 'llm',      position: { x: col(3), y: row(0)              }, data: style },
    { id: coverageId,    type: 'llm',      position: { x: col(3), y: row(0) + ROW_H      }, data: coverage },
    { id: joinId,        type: 'join',     position: { x: col(4), y: row(0)              }, data: joinData },
    { id: synthesizeId,  type: 'llm',      position: { x: col(5), y: row(0)              }, data: synthesize },
    { id: postCommentId, type: 'action',   position: { x: col(6), y: row(0)              }, data: postComment },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', summarizeId),
    edge(summarizeId, 'out', forkId),
    edge(forkId, 'branch-0', securityId),
    edge(forkId, 'branch-1', styleId),
    edge(forkId, 'branch-2', coverageId),
    edge(securityId, 'out', joinId, 'in-0'),
    edge(styleId,    'out', joinId, 'in-1'),
    edge(coverageId, 'out', joinId, 'in-2'),
    edge(joinId, 'out', synthesizeId),
    edge(synthesizeId, 'out', postCommentId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Code Review',
    description:
      'GitHub PR webhook fans out security, style, and test-coverage reviews in parallel, then synthesizes one PR comment.',
    icon: '🔍',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'webhook', webhookPath: '/pipelines/webhooks/github-pr' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 12. Content moderation (publish gate) — submit → classify → condition →
//     publish | mod-review approval
// ---------------------------------------------------------------------------

function buildContentModerationPublishGate(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const classifyId = crypto.randomUUID();
  const cleanConditionId = crypto.randomUUID();
  const publishId = crypto.randomUUID();
  const modReviewId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'document.submit',
  };

  const classify: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'Classify this newly created document for safety. Output strict JSON {"category": "clean"|"pii"|"policy_violation", "reason": string}. No prose.',
    userPromptTemplate: '{{context.documentBody}}',
    temperature: 0,
    maxTokens: 192,
    streaming: false,
  };

  const cleanCondition: ConditionNodeData = {
    type: 'condition',
    expression: `context.steps.${classifyId}.output.category === 'clean'`,
    label: 'Clean?',
  };

  const publish: ActionNodeData = {
    type: 'action',
    actionType: 'update-document',
    config: { field: 'status', value: 'published' },
    idempotent: true,
    onError: 'fail-run',
  };

  const modReview: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'role', value: 'moderator' }],
    requiredCount: 1,
    timeoutMs: 12 * 60 * 60 * 1000,
    timeoutAction: 'reject',
    message: `Document flagged as {{context.steps.${classifyId}.output.category}} — please review before publishing.`,
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,         type: 'trigger',   position: { x: col(0), y: row(0)              }, data: triggerData },
    { id: classifyId,        type: 'llm',       position: { x: col(1), y: row(0)              }, data: classify },
    { id: cleanConditionId,  type: 'condition', position: { x: col(2), y: row(0)              }, data: cleanCondition },
    { id: publishId,         type: 'action',    position: { x: col(3), y: row(0) - ROW_H / 2 }, data: publish },
    { id: modReviewId,       type: 'approval',  position: { x: col(3), y: row(0) + ROW_H / 2 }, data: modReview },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', classifyId),
    edge(classifyId, 'out', cleanConditionId),
    edge(cleanConditionId, 'true', publishId),
    edge(cleanConditionId, 'false', modReviewId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Content Moderation (Publish Gate)',
    description:
      'On document creation, classify safety (PII / policy / clean); auto-publish clean docs, route flagged ones to moderator approval.',
    icon: '🛡️',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'document.submit' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// 13. Customer support triage — webhook → classify → transform → condition →
//     escalate | draft → approval → send
// ---------------------------------------------------------------------------

function buildSupportTriage(createdBy: string): PipelineDefinition {
  const now = new Date().toISOString();

  const triggerId = crypto.randomUUID();
  const classifyId = crypto.randomUUID();
  const normalizeId = crypto.randomUUID();
  const urgencyConditionId = crypto.randomUUID();
  const escalateId = crypto.randomUUID();
  const draftId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const sendId = crypto.randomUUID();

  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'webhook',
    webhookPath: '/pipelines/webhooks/helpdesk',
  };

  const classify: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'Read this helpdesk ticket. Extract intent and urgency. Output strict JSON {"intent": string, "urgency": "high"|"medium"|"low", "tags": string[]}. No prose.',
    userPromptTemplate: '{{context.payload.ticket}}',
    temperature: 0.1,
    maxTokens: 256,
    streaming: false,
  };

  const normalize: TransformNodeData = {
    type: 'transform',
    transformType: 'jsonpath',
    expression: `$.steps.${classifyId}.output`,
    outputKey: 'triage',
  };

  const urgencyCondition: ConditionNodeData = {
    type: 'condition',
    expression: `context.triage.urgency === 'high'`,
    label: 'High urgency?',
  };

  const escalate: ActionNodeData = {
    type: 'action',
    actionType: 'notify',
    config: {
      channel: 'support-escalations',
      message:
        `High-urgency ticket: {{context.triage.intent}} (tags: {{context.triage.tags}})`,
    },
    idempotent: false,
    onError: 'fail-run',
  };

  const draft: LLMNodeData = {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a customer-support agent. Draft a friendly, concise reply addressing the ticket intent. Sign off as "The Support Team". Plain text, no markdown.',
    userPromptTemplate:
      `Ticket: {{context.payload.ticket}}\n\nIntent: {{context.triage.intent}}\nTags: {{context.triage.tags}}`,
    temperature: 0.4,
    maxTokens: 768,
    streaming: true,
  };

  const approval: ApprovalNodeData = {
    type: 'approval',
    approvers: [{ type: 'role', value: 'support-agent' }],
    requiredCount: 1,
    timeoutMs: 4 * 60 * 60 * 1000,
    timeoutAction: 'reject',
    message: `Please review this drafted reply before it is sent to the customer.`,
  };

  const send: ActionNodeData = {
    type: 'action',
    actionType: 'webhook',
    config: {
      url: 'https://helpdesk.example.com/api/replies',
      method: 'POST',
      body: {
        ticketId: '{{context.payload.ticket.id}}',
        body: `{{context.steps.${draftId}.response}}`,
      },
    },
    idempotent: true,
    onError: 'route-error',
  };

  const nodes: PipelineNode[] = [
    { id: triggerId,            type: 'trigger',   position: { x: col(0), y: row(0)              }, data: triggerData },
    { id: classifyId,           type: 'llm',       position: { x: col(1), y: row(0)              }, data: classify },
    { id: normalizeId,          type: 'transform', position: { x: col(2), y: row(0)              }, data: normalize },
    { id: urgencyConditionId,   type: 'condition', position: { x: col(3), y: row(0)              }, data: urgencyCondition },
    { id: escalateId,           type: 'action',    position: { x: col(4), y: row(0) - ROW_H / 2 }, data: escalate },
    { id: draftId,              type: 'llm',       position: { x: col(4), y: row(0) + ROW_H / 2 }, data: draft },
    { id: approvalId,           type: 'approval',  position: { x: col(5), y: row(0) + ROW_H / 2 }, data: approval },
    { id: sendId,               type: 'action',    position: { x: col(6), y: row(0) + ROW_H / 2 }, data: send },
  ];

  const edges: PipelineEdge[] = [
    edge(triggerId, 'out', classifyId),
    edge(classifyId, 'out', normalizeId),
    edge(normalizeId, 'out', urgencyConditionId),
    edge(urgencyConditionId, 'true', escalateId),
    edge(urgencyConditionId, 'false', draftId),
    edge(draftId, 'out', approvalId),
    edge(approvalId, 'approved', sendId),
  ];

  return {
    id: crypto.randomUUID(),
    name: 'Customer Support Triage',
    description:
      'Helpdesk webhook classifies intent and urgency; high-urgency tickets escalate, others get an agent-reviewed draft reply auto-sent on approval.',
    icon: '🎧',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    triggerBinding: { event: 'webhook', webhookPath: '/pipelines/webhooks/helpdesk' },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const pipelineTemplates: PipelineTemplate[] = [
  {
    id: 'document-summary',
    name: 'Document Summary',
    description: 'Summarize a finalized document and post the summary as a comment.',
    icon: '📄',
    tags: ['llm', 'summary', 'document'],
    build: buildDocumentSummary,
  },
  {
    id: 'meeting-notes-assistant',
    name: 'Meeting Notes Assistant',
    description: 'Extract action items and send a team summary in parallel when meeting notes are finalized.',
    icon: '📝',
    tags: ['llm', 'parallel', 'meeting', 'tasks'],
    build: buildMeetingNotesAssistant,
  },
  {
    id: 'content-moderation',
    name: 'Content Moderation',
    description: 'Classify comments for safety; auto-post safe ones, flag risky ones for human review.',
    icon: '🛡️',
    tags: ['llm', 'moderation', 'approval', 'condition'],
    build: buildContentModeration,
  },
  {
    id: 'auto-tag-document',
    name: 'Auto-tag Document',
    description: 'Extract tags from a finalized document using an LLM and write them back.',
    icon: '🏷️',
    tags: ['llm', 'tags', 'transform'],
    build: buildAutoTagDocument,
  },
  {
    id: 'approval-chain',
    name: 'Approval Chain',
    description: 'Require team-lead then director approval before publishing a finalized document.',
    icon: '✅',
    tags: ['approval', 'governance'],
    build: buildApprovalChain,
  },
  {
    id: 'webhook-translate-publish',
    name: 'Webhook → Translate → Publish',
    description: 'Receive a webhook payload, extract text, translate to English, and post it as a comment.',
    icon: '🌐',
    tags: ['webhook', 'llm', 'translate'],
    build: buildWebhookTranslatePublish,
  },
  {
    id: 'daily-document-digest',
    name: 'Daily Document Digest',
    description: 'Every morning at 9am, summarize the last 24h of document activity and post it to a digest doc.',
    icon: '📰',
    tags: ['schedule', 'llm', 'digest', 'cron'],
    build: buildDailyDocumentDigest,
  },
  {
    id: 'auto-tag-on-creation',
    name: 'Auto-tag on Creation',
    description: 'When a new document is submitted, extract tags with an LLM and write them back to the document.',
    icon: '🏷️',
    tags: ['llm', 'tags', 'submit'],
    build: buildAutoTagOnCreation,
  },
  {
    id: 'pr-style-review',
    name: 'PR-style Review',
    description: 'Finalize a document, run an LLM review and human approval in parallel, then notify when both complete.',
    icon: '🔍',
    tags: ['fork', 'llm', 'approval', 'review', 'join'],
    build: buildPrStyleReview,
  },
  {
    id: 'incident-response',
    name: 'Incident Response',
    description:
      'Webhook from PagerDuty/Opsgenie triages severity; critical alerts page on-call and request a post-mortem owner, others file a ticket.',
    icon: '🚨',
    tags: ['webhook', 'incident', 'ops', 'condition', 'approval'],
    build: buildIncidentResponse,
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description:
      'GitHub PR webhook fans out security, style, and test-coverage reviews in parallel, then synthesizes one PR comment.',
    icon: '🔍',
    tags: ['webhook', 'fork', 'llm', 'review', 'github', 'join'],
    build: buildCodeReview,
  },
  {
    id: 'content-moderation-publish-gate',
    name: 'Content Moderation (Publish Gate)',
    description:
      'On document creation, classify safety (PII / policy / clean); auto-publish clean docs, route flagged ones to moderator approval.',
    icon: '🛡️',
    tags: ['moderation', 'llm', 'condition', 'approval', 'submit'],
    build: buildContentModerationPublishGate,
  },
  {
    id: 'support-triage',
    name: 'Customer Support Triage',
    description:
      'Helpdesk webhook classifies intent and urgency; high-urgency tickets escalate, others get an agent-reviewed draft reply auto-sent on approval.',
    icon: '🎧',
    tags: ['webhook', 'support', 'llm', 'condition', 'approval', 'transform'],
    build: buildSupportTriage,
  },
];
