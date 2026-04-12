// frontend/src/utils/documentExport.ts
//
// Export utilities for converting structured DocumentData back into
// plain markdown or plain-text formats.

import type { DocumentData, Section, TaskItem } from '../types/document';

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

function taskToMarkdown(item: TaskItem): string {
  const checked = item.status === 'done' || item.status === 'acked';
  return `- [${checked ? 'x' : ' '}] ${item.text}`;
}

function sectionToMarkdown(section: Section): string {
  const lines: string[] = [`## ${section.title}`, ''];

  // Section body content (stored on the Section or via contentMarkdown/contentText cast)
  const content =
    ((section as unknown as Record<string, unknown>)['contentMarkdown'] as string | undefined) ??
    ((section as unknown as Record<string, unknown>)['contentText'] as string | undefined);
  if (content) {
    lines.push(content, '');
  }

  if (section.items.length > 0) {
    for (const item of section.items) {
      lines.push(taskToMarkdown(item));
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert a full DocumentData structure to a markdown string.
 */
export function exportToMarkdown(doc: DocumentData): string {
  const parts: string[] = [`# ${doc.meta.title}`, ''];

  for (const section of doc.sections) {
    parts.push(sectionToMarkdown(section));
  }

  return parts.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// Plain-text export
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<TaskItem['status'], string> = {
  pending: 'PENDING',
  acked: 'ACKED',
  done: 'DONE',
  rejected: 'REJECTED',
};

function taskToPlainText(item: TaskItem): string {
  return `[${STATUS_LABEL[item.status]}] ${item.text}`;
}

function sectionToPlainText(section: Section): string {
  const lines: string[] = [section.title, ''];

  const content =
    ((section as unknown as Record<string, unknown>)['contentMarkdown'] as string | undefined) ??
    ((section as unknown as Record<string, unknown>)['contentText'] as string | undefined);
  if (content) {
    lines.push(content, '');
  }

  if (section.items.length > 0) {
    for (const item of section.items) {
      lines.push(taskToPlainText(item));
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert a full DocumentData structure to plain text (no markdown syntax).
 */
export function exportToPlainText(doc: DocumentData): string {
  const parts: string[] = [doc.meta.title, ''];

  for (const section of doc.sections) {
    parts.push(sectionToPlainText(section));
  }

  return parts.join('\n').trimEnd() + '\n';
}
