// frontend/src/components/doc-editor/useDocumentActions.ts
//
// Custom hook encapsulating demo loading, document clear, and export logic.
// Extracted from DocumentEditorPage to reduce that file's responsibilities.

import { useState, useCallback } from 'react';
import type { UseWebSocketReturn } from '../../hooks/useWebSocket';
import type { XmlFragment } from 'yjs';
import type { CommentThread } from '../../types/document';
import { parseMarkdownToSections } from '../../utils/markdownParser';
import { exportToMarkdown } from '../../utils/documentExport';
import { DEMO_MARKDOWN } from '../../utils/demoDocument';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a Y.XmlFragment.
 */
function xmlFragmentToText(frag: { toString(): string }): string {
  const xml = frag.toString();
  return xml
    .replace(/<\/?(paragraph|heading|blockquote|codeBlock|bulletList|orderedList|listItem|taskList|taskItem|horizontalRule|hardBreak|doc)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Minimal markdown-to-HTML converter for PDF export.
 */
function simpleMarkdownToHtml(md: string): string {
  return md
    .split('\n')
    .map(line => {
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith('> ')) return `<blockquote>${line.slice(2)}</blockquote>`;
      if (line.startsWith('- [x] ')) return `<li>&#9745; ${line.slice(6)}</li>`;
      if (line.startsWith('- [ ] ')) return `<li>&#9744; ${line.slice(6)}</li>`;
      if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
      if (line.trim() === '') return '<br/>';
      return `<p>${line}</p>`;
    })
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDocumentActionsArgs {
  documentId: string;
  userId: string;
  ws: UseWebSocketReturn;
  updateMeta: (meta: import('../../types/document').DocumentMeta) => void;
  addSection: (section: import('../../types/document').Section) => void;
  exportJSON: () => { meta: import('../../types/document').DocumentMeta; sections: import('../../types/document').Section[] } | null;
  getSectionFragment: (sectionId: string) => XmlFragment | null;
  comments: Record<string, CommentThread[]>;
}

export function useDocumentActions({
  documentId,
  userId,
  ws,
  updateMeta,
  addSection,
  exportJSON,
  getSectionFragment,
  comments,
}: UseDocumentActionsArgs) {
  const [demoLoaded, setDemoLoaded] = useState(false);

  const handleLoadDemo = useCallback(() => {
    const parsed = parseMarkdownToSections(DEMO_MARKDOWN);

    updateMeta({
      id: documentId,
      title: parsed.meta.title || 'Untitled',
      sourceType: 'notes',
      sourceId: '',
      createdBy: userId,
      createdAt: new Date().toISOString(),
      aiModel: '',
      status: 'draft',
    });

    for (const section of parsed.sections) {
      addSection({
        id: section.id,
        type: section.type,
        title: section.title,
        collapsed: false,
        items: section.items,
      });
    }

    setDemoLoaded(true);
  }, [documentId, userId, updateMeta, addSection]);

  const handleClearDocument = useCallback(() => {
    ws.sendMessage({
      service: 'crdt',
      action: 'clearDocument',
      channel: `doc:${documentId}`,
    });
    setDemoLoaded(false);
  }, [ws, documentId]);

  const handleExport = useCallback((format: 'markdown' | 'pdf' | 'json') => {
    const data = exportJSON();
    if (!data) return;

    // Enrich sections with rich-text content and comments
    for (const section of data.sections) {
      const frag = getSectionFragment(section.id);
      if (frag) {
        (section as any).contentText = xmlFragmentToText(frag);
      }
      const sectionComments = comments[section.id];
      if (sectionComments && sectionComments.length > 0) {
        (section as any).comments = sectionComments;
      }
    }

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${data.meta.title || 'document'}.json`);
    } else if (format === 'markdown') {
      const md = exportToMarkdown(data);
      const blob = new Blob([md], { type: 'text/markdown' });
      downloadBlob(blob, `${data.meta.title || 'document'}.md`);
    } else if (format === 'pdf') {
      const md = exportToMarkdown(data);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
          <head>
            <title>${data.meta.title || 'Document'}</title>
            <style>
              body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.6; }
              h1 { font-size: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
              h2 { font-size: 18px; margin-top: 24px; }
              h3 { font-size: 14px; color: #64748b; }
              ul { padding-left: 20px; }
              li { margin: 4px 0; }
              blockquote { border-left: 3px solid #e2e8f0; margin: 8px 0; padding: 4px 12px; color: #64748b; }
              code { background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
              @media print { body { margin: 0; } }
            </style>
          </head>
          <body>${simpleMarkdownToHtml(md)}</body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  }, [exportJSON, getSectionFragment, comments]);

  return {
    demoLoaded,
    handleLoadDemo,
    handleClearDocument,
    handleExport,
  };
}
