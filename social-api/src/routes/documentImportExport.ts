import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../lib/aws-clients';
import {
  documentCommentRepo,
  sectionReviewRepo,
  sectionItemRepo,
  approvalWorkflowRepo,
  documentSectionRepo,
} from '../repositories';
import type { DocumentComment } from '../repositories/DocumentCommentRepository';
import type { SectionItemFields } from '../repositories/SectionItemRepository';
import type { SectionReview } from '../repositories/SectionReviewRepository';
import type { ApprovalWorkflow } from '../repositories/ApprovalWorkflowRepository';
import type { DocumentSectionFields } from '../repositories/DocumentSectionRepository';

const DOCUMENTS_TABLE = process.env.DYNAMODB_DOCUMENTS_TABLE || 'crdt-documents';

export const documentImportExportRouter = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DocumentMeta {
  id: string;
  title: string;
  type: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  icon?: string;
  description?: string;
}

async function getDocumentMeta(documentId: string): Promise<DocumentMeta | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: { documentId },
    }),
  );
  if (!result.Item) return null;
  const item = result.Item;
  return {
    id: item['documentId'] as string,
    title: (item['title'] as string) ?? 'Untitled',
    type: (item['type'] as string) ?? 'custom',
    status: (item['status'] as string) ?? 'draft',
    createdBy: (item['createdBy'] as string) ?? 'unknown',
    createdAt: (item['createdAt'] as string) ?? new Date().toISOString(),
    updatedAt: (item['updatedAt'] as string) ?? new Date().toISOString(),
    ...(item['icon'] ? { icon: item['icon'] as string } : {}),
    ...(item['description'] ? { description: item['description'] as string } : {}),
  };
}

function buildJsonExport(
  meta: DocumentMeta,
  sections: DocumentSectionFields[],
  comments: DocumentComment[],
  reviews: SectionReview[],
  items: SectionItemFields[],
  workflows: ApprovalWorkflow[],
) {
  // Group comments, items, and reviews by sectionId
  const commentsBySection = new Map<string, DocumentComment[]>();
  for (const c of comments) {
    const list = commentsBySection.get(c.sectionId) ?? [];
    list.push(c);
    commentsBySection.set(c.sectionId, list);
  }

  const itemsBySection = new Map<string, SectionItemFields[]>();
  for (const i of items) {
    const list = itemsBySection.get(i.sectionId) ?? [];
    list.push(i);
    itemsBySection.set(i.sectionId, list);
  }

  const reviewsBySection = new Map<string, SectionReview[]>();
  for (const r of reviews) {
    const list = reviewsBySection.get(r.sectionId) ?? [];
    list.push(r);
    reviewsBySection.set(r.sectionId, list);
  }

  return {
    document: {
      meta: {
        id: meta.id,
        title: meta.title,
        type: meta.type,
        status: meta.status,
        createdBy: meta.createdBy,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        ...(meta.icon ? { icon: meta.icon } : {}),
        ...(meta.description ? { description: meta.description } : {}),
      },
      sections: sections.map((s) => ({
        id: s.sectionId,
        title: s.title,
        type: s.type,
        ...(s.sectionType ? { sectionType: s.sectionType } : {}),
        sortOrder: s.sortOrder,
        items: (itemsBySection.get(s.sectionId) ?? []).map((i) => ({
          id: i.itemId,
          text: i.text,
          status: i.status,
          ...(i.assignee ? { assignee: i.assignee } : {}),
          ...(i.priority ? { priority: i.priority } : {}),
          ...(i.dueDate ? { dueDate: i.dueDate } : {}),
          ...(i.category ? { category: i.category } : {}),
          ...(i.notes ? { notes: i.notes } : {}),
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        })),
        comments: (commentsBySection.get(s.sectionId) ?? []).map((c) => ({
          id: c.commentId,
          text: c.text,
          userId: c.userId,
          displayName: c.displayName,
          timestamp: c.timestamp,
          ...(c.parentCommentId ? { parentCommentId: c.parentCommentId } : {}),
          ...(c.resolved !== undefined ? { resolved: c.resolved } : {}),
        })),
        reviews: (reviewsBySection.get(s.sectionId) ?? []).map((r) => ({
          userId: r.userId,
          displayName: r.displayName,
          status: r.status,
          timestamp: r.timestamp,
          ...(r.comment ? { comment: r.comment } : {}),
        })),
      })),
      workflows: workflows.map((w) => ({
        name: w.name,
        type: w.type,
        steps: w.steps,
        status: w.workflowStatus,
        createdBy: w.createdBy,
        createdAt: w.createdAt,
      })),
    },
  };
}

function buildMarkdownExport(
  meta: DocumentMeta,
  sections: DocumentSectionFields[],
  comments: DocumentComment[],
  reviews: SectionReview[],
  items: SectionItemFields[],
): string {
  const lines: string[] = [];

  lines.push(`# ${meta.title}`);
  lines.push(`Status: ${meta.status} | Created by: ${meta.createdBy} | Date: ${meta.createdAt.split('T')[0]}`);
  lines.push('');

  // Group by section
  const commentsBySection = new Map<string, DocumentComment[]>();
  for (const c of comments) {
    const list = commentsBySection.get(c.sectionId) ?? [];
    list.push(c);
    commentsBySection.set(c.sectionId, list);
  }

  const itemsBySection = new Map<string, SectionItemFields[]>();
  for (const i of items) {
    const list = itemsBySection.get(i.sectionId) ?? [];
    list.push(i);
    itemsBySection.set(i.sectionId, list);
  }

  const reviewsBySection = new Map<string, SectionReview[]>();
  for (const r of reviews) {
    const list = reviewsBySection.get(r.sectionId) ?? [];
    list.push(r);
    reviewsBySection.set(r.sectionId, list);
  }

  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push('');

    // Action items
    const sectionItems = itemsBySection.get(section.sectionId) ?? [];
    if (sectionItems.length > 0) {
      lines.push('### Action Items');
      for (const item of sectionItems) {
        const check = item.status === 'done' ? 'x' : ' ';
        const parts: string[] = [];
        if (item.assignee) parts.push(`@${item.assignee}`);
        if (item.priority) parts.push(`priority: ${item.priority}`);
        if (item.dueDate) parts.push(`due: ${item.dueDate}`);
        const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        lines.push(`- [${check}] ${item.text}${suffix}`);
      }
      lines.push('');
    }

    // Comments — threaded
    const sectionComments = commentsBySection.get(section.sectionId) ?? [];
    const topLevel = sectionComments.filter((c) => !c.parentCommentId);
    if (topLevel.length > 0) {
      lines.push('### Comments');
      for (const comment of topLevel) {
        const date = comment.timestamp.split('T')[0];
        lines.push(`> **${comment.displayName}** (${date}): ${comment.text}`);
        // Replies
        const replies = sectionComments.filter((c) => c.parentCommentId === comment.commentId);
        for (const reply of replies) {
          const replyDate = reply.timestamp.split('T')[0];
          lines.push(`>   > **${reply.displayName}** (${replyDate}): ${reply.text}`);
        }
      }
      lines.push('');
    }

    // Reviews
    const sectionReviews = reviewsBySection.get(section.sectionId) ?? [];
    if (sectionReviews.length > 0) {
      lines.push('### Reviews');
      for (const review of sectionReviews) {
        const date = review.timestamp.split('T')[0];
        const label = review.status.charAt(0).toUpperCase() + review.status.slice(1);
        lines.push(`- ${label} by ${review.displayName} (${date})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parse markdown into sections + items for import
// ---------------------------------------------------------------------------

interface ParsedSection {
  title: string;
  items: Array<{ text: string; status: string; assignee?: string; priority?: string }>;
}

function parseMarkdownSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const line of content.split('\n')) {
    // Section heading (## )
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      current = { title: sectionMatch[1].trim(), items: [] };
      sections.push(current);
      continue;
    }

    // Action item: - [x] or - [ ]
    const itemMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (itemMatch && current) {
      const done = itemMatch[1].toLowerCase() === 'x';
      let text = itemMatch[2].trim();
      let assignee: string | undefined;
      let priority: string | undefined;

      // Extract parenthesized metadata at the end: (@user, priority: high)
      const metaMatch = text.match(/\(([^)]+)\)\s*$/);
      if (metaMatch) {
        text = text.slice(0, text.length - metaMatch[0].length).trim();
        const metaParts = metaMatch[1].split(',').map((p) => p.trim());
        for (const part of metaParts) {
          if (part.startsWith('@')) {
            assignee = part.slice(1);
          } else if (part.toLowerCase().startsWith('priority:')) {
            priority = part.split(':')[1].trim();
          }
        }
      }

      current.items.push({
        text,
        status: done ? 'done' : 'open',
        ...(assignee ? { assignee } : {}),
        ...(priority ? { priority } : {}),
      });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// GET /api/documents/:documentId/export?format=json|md
// ---------------------------------------------------------------------------

documentImportExportRouter.get(
  '/export',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { documentId } = req.params;
      const format = (req.query['format'] as string) ?? 'json';

      if (format !== 'json' && format !== 'md') {
        res.status(400).json({ error: 'format must be "json" or "md"' });
        return;
      }

      // Fetch document metadata
      const meta = await getDocumentMeta(documentId);
      if (!meta) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Fetch all related data in parallel
      const [sections, commentsResult, reviews, items, workflows] = await Promise.all([
        documentSectionRepo.getSectionsForDocument(documentId),
        documentCommentRepo.getCommentsForDocument(documentId),
        sectionReviewRepo.getReviewsForDocument(documentId),
        sectionItemRepo.getItemsForDocument(documentId),
        approvalWorkflowRepo.getWorkflowsForDocument(documentId),
      ]);

      const comments = commentsResult.items;

      if (format === 'json') {
        res.status(200).json(buildJsonExport(meta, sections, comments, reviews, items, workflows));
      } else {
        const md = buildMarkdownExport(meta, sections, comments, reviews, items);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${meta.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md"`,
        );
        res.status(200).send(md);
      }
    } catch (err) {
      console.error('[import-export] GET /export error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/documents/:documentId/import
// ---------------------------------------------------------------------------

documentImportExportRouter.post(
  '/import',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { documentId } = req.params;
      const { format, content } = req.body as { format?: string; content?: string };

      if (!format || (format !== 'markdown' && format !== 'json')) {
        res.status(400).json({ error: 'format must be "markdown" or "json"' });
        return;
      }
      if (!content || typeof content !== 'string' || !content.trim()) {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      // Verify document exists
      const meta = await getDocumentMeta(documentId);
      if (!meta) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      let sectionsCreated = 0;
      let itemsCreated = 0;

      if (format === 'markdown') {
        const parsed = parseMarkdownSections(content);

        // Determine starting sortOrder from existing sections
        const existing = await documentSectionRepo.getSectionsForDocument(documentId);
        let sortOrder = existing.length > 0
          ? Math.max(...existing.map((s) => s.sortOrder)) + 1
          : 0;

        for (const section of parsed) {
          const newSection = await documentSectionRepo.createSection({
            documentId,
            type: 'text',
            title: section.title,
            sortOrder: sortOrder++,
          });
          sectionsCreated++;

          for (const item of section.items) {
            await sectionItemRepo.createItem({
              documentId,
              sectionId: newSection.sectionId,
              text: item.text,
              status: item.status,
              ...(item.assignee ? { assignee: item.assignee } : {}),
              ...(item.priority ? { priority: item.priority } : {}),
            });
            itemsCreated++;
          }
        }
      } else {
        // JSON import
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(content);
        } catch {
          res.status(400).json({ error: 'Invalid JSON content' });
          return;
        }

        const doc = data['document'] as Record<string, unknown> | undefined;
        const importSections = (doc?.['sections'] ?? []) as Array<Record<string, unknown>>;

        // Determine starting sortOrder
        const existing = await documentSectionRepo.getSectionsForDocument(documentId);
        let sortOrder = existing.length > 0
          ? Math.max(...existing.map((s) => s.sortOrder)) + 1
          : 0;

        for (const sec of importSections) {
          const newSection = await documentSectionRepo.createSection({
            documentId,
            type: (sec['type'] as string) ?? 'text',
            title: (sec['title'] as string) ?? 'Untitled',
            ...(sec['sectionType'] ? { sectionType: sec['sectionType'] as string } : {}),
            sortOrder: sortOrder++,
          });
          sectionsCreated++;

          const secItems = (sec['items'] ?? []) as Array<Record<string, unknown>>;
          for (const item of secItems) {
            await sectionItemRepo.createItem({
              documentId,
              sectionId: newSection.sectionId,
              text: (item['text'] as string) ?? '',
              status: (item['status'] as string) ?? 'open',
              ...(item['assignee'] ? { assignee: item['assignee'] as string } : {}),
              ...(item['priority'] ? { priority: item['priority'] as string } : {}),
              ...(item['dueDate'] ? { dueDate: item['dueDate'] as string } : {}),
              ...(item['category'] ? { category: item['category'] as string } : {}),
            });
            itemsCreated++;
          }
        }
      }

      res.status(201).json({ documentId, sectionsCreated, itemsCreated });
    } catch (err) {
      console.error('[import-export] POST /import error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
