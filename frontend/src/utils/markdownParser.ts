// frontend/src/utils/markdownParser.ts
//
// Zero-dependency markdown parser that converts AI-generated markdown
// into structured document sections. Uses simple regex splitting
// rather than a full AST library for speed and bundle size.

import type { Section, TaskItem, DocumentMeta } from '../types/document';

/** Generate a simple unique ID (no external dependency). */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface ParsedDocument {
  meta: Partial<DocumentMeta>;
  sections: ParsedSection[];
}

export interface ParsedSection {
  id: string;
  type: Section['type'];
  title: string;
  contentMarkdown: string;
  items: TaskItem[];
}

// ---------------------------------------------------------------------------
// Heading regex: match lines starting with ## (section) or # (title).
// We split on ## but capture # as the document title.
// ---------------------------------------------------------------------------

const TASK_LINE = /^- \[([ xX])\]\s+(.+)$/;

/**
 * Infer the section type from its title and body content.
 */
export function inferSectionType(
  title: string,
  content: string,
): Section['type'] {
  const lower = title.toLowerCase();
  if (TASK_LINE.test(content) || /- \[[ xX]\]/.test(content)) return 'tasks';
  if (lower.includes('decision')) return 'decisions';
  if (lower.includes('summary')) return 'summary';
  return 'notes';
}

/**
 * Parse a block of markdown lines and extract TaskItem entries from checkbox
 * lines. Returns the items and the remaining (non-checkbox) content.
 */
function extractTasks(body: string): { items: TaskItem[]; remaining: string } {
  const lines = body.split('\n');
  const items: TaskItem[] = [];
  const rest: string[] = [];

  for (const line of lines) {
    const match = line.match(TASK_LINE);
    if (match) {
      const checked = match[1].toLowerCase() === 'x';
      items.push({
        id: uid(),
        text: match[2].trim(),
        status: checked ? 'done' : 'pending',
        assignee: '',
        ackedBy: '',
        ackedAt: '',
        priority: 'medium',
        notes: '',
      });
    } else {
      rest.push(line);
    }
  }

  return {
    items,
    remaining: rest.join('\n').trim(),
  };
}

/**
 * Parse a full markdown string into a structured ParsedDocument.
 *
 * Rules:
 * 1. `# ` at the start of the document is the document title.
 * 2. Each `## ` heading starts a new section.
 * 3. Checkbox lines (`- [ ]` / `- [x]`) become TaskItem entries.
 * 4. If no `##` headings exist the entire text is one 'summary' section.
 */
export function parseMarkdownToSections(markdown: string): ParsedDocument {
  const meta: Partial<DocumentMeta> = {};
  const sections: ParsedSection[] = [];

  // Normalise line endings
  const text = markdown.replace(/\r\n/g, '\n');

  // Extract document title (first # heading)
  const titleMatch = text.match(/^# (.+)$/m);
  if (titleMatch) {
    meta.title = titleMatch[1].trim();
  }

  // Split on ## headings. We use a regex that keeps the delimiter.
  // The split produces: [preamble, heading1, body1, heading2, body2, ...]
  const parts = text.split(/^## /m);

  // If there is only one part (no ## headings), treat entire doc as summary.
  if (parts.length <= 1) {
    // Remove the title line if present
    const body = text.replace(/^# .+\n*/m, '').trim();
    if (body.length > 0) {
      const { items, remaining } = extractTasks(body);
      sections.push({
        id: uid(),
        type: 'summary',
        title: meta.title ?? 'Untitled',
        contentMarkdown: remaining,
        items,
      });
    }
    return { meta, sections };
  }

  // parts[0] is preamble (before first ##), parts[1..] each start with heading text
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    // First line of chunk is the heading text (rest of the line after ##)
    const newlineIdx = chunk.indexOf('\n');
    const title =
      newlineIdx === -1 ? chunk.trim() : chunk.slice(0, newlineIdx).trim();
    const body = newlineIdx === -1 ? '' : chunk.slice(newlineIdx + 1).trim();

    const { items, remaining } = extractTasks(body);
    const sectionType = inferSectionType(title, body);

    sections.push({
      id: uid(),
      type: sectionType,
      title,
      contentMarkdown: remaining,
      items,
    });
  }

  return { meta, sections };
}
