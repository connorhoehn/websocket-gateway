import { describe, it, expect } from 'vitest';
import { parseMarkdownToSections, inferSectionType } from '../markdownParser';

describe('parseMarkdownToSections', () => {
  it('parses heading + tasks', () => {
    const md = `# Meeting Notes\n\n## Action Items\n\n- [ ] Fix login bug\n- [x] Deploy hotfix\n\n## Summary\n\nWe discussed the roadmap.`;
    const result = parseMarkdownToSections(md);
    expect(result.meta.title).toBe('Meeting Notes');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].type).toBe('tasks');
    expect(result.sections[0].items).toHaveLength(2);
    expect(result.sections[0].items[0].status).toBe('pending');
    expect(result.sections[0].items[1].status).toBe('done');
    expect(result.sections[1].type).toBe('summary');
  });

  it('handles no headings', () => {
    const md = 'Just plain text content.';
    const result = parseMarkdownToSections(md);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe('summary');
  });

  it('detects decision sections', () => {
    const md = '# Doc\n\n## Key Decisions\n\nWe chose option A.';
    const result = parseMarkdownToSections(md);
    expect(result.sections[0].type).toBe('decisions');
  });

  it('handles mixed content and checkboxes', () => {
    const md = '# Plan\n\n## Tasks\n\nSome intro text.\n\n- [ ] First task\n- [x] Second task\n\nSome trailing text.';
    const result = parseMarkdownToSections(md);
    expect(result.sections[0].items).toHaveLength(2);
    expect(result.sections[0].contentMarkdown).toContain('Some intro text.');
    expect(result.sections[0].contentMarkdown).toContain('Some trailing text.');
  });
});

describe('inferSectionType', () => {
  it('returns tasks when content has checkboxes', () => {
    expect(inferSectionType('Stuff', '- [ ] do thing')).toBe('tasks');
  });

  it('returns decisions for decision titles', () => {
    expect(inferSectionType('Key Decisions', 'text')).toBe('decisions');
  });

  it('returns summary for summary titles', () => {
    expect(inferSectionType('Executive Summary', 'text')).toBe('summary');
  });

  it('returns notes as default', () => {
    expect(inferSectionType('Random', 'text')).toBe('notes');
  });
});
