// Tests for document-importer: parseMarkdownSections, parseJsonImport, applyImport.
//
// Parser tests are pure (no mocks). applyImport uses injected deps so
// we pass mock repos without jest.mock.

import { ValidationError } from '../../middleware/error-handler';
import {
  parseMarkdownSections,
  parseJsonImport,
  applyImport,
  type ParsedSection,
} from '../document-importer';

describe('parseMarkdownSections', () => {
  it('parses sections from ## headings', () => {
    const result = parseMarkdownSections('## Intro\n\n## Details\n');
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Intro');
    expect(result[1].title).toBe('Details');
  });

  it('parses action items with checkboxes', () => {
    const md = '## Tasks\n- [ ] Do this\n- [x] Done that\n';
    const result = parseMarkdownSections(md);
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items[0]).toEqual({ text: 'Do this', status: 'open' });
    expect(result[0].items[1]).toEqual({ text: 'Done that', status: 'done' });
  });

  it('extracts assignee and priority from trailing metadata', () => {
    const md = '## Tasks\n- [ ] Fix bug (@bob, priority: high)\n';
    const result = parseMarkdownSections(md);
    expect(result[0].items[0]).toEqual(expect.objectContaining({
      text: 'Fix bug',
      assignee: 'bob',
      priority: 'high',
    }));
  });

  it('throws on empty input', () => {
    expect(() => parseMarkdownSections('')).toThrow(ValidationError);
    expect(() => parseMarkdownSections('   ')).toThrow(ValidationError);
  });

  it('throws on non-string input', () => {
    expect(() => parseMarkdownSections(null)).toThrow(ValidationError);
    expect(() => parseMarkdownSections(42)).toThrow(ValidationError);
  });

  it('throws when no section headings found', () => {
    expect(() => parseMarkdownSections('just plain text')).toThrow(
      /section headings/,
    );
  });

  it('ignores items before first section heading', () => {
    const md = '- [ ] orphan item\n## Section\n- [ ] real item\n';
    const result = parseMarkdownSections(md);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].text).toBe('real item');
  });
});

describe('parseJsonImport', () => {
  it('parses valid JSON string', () => {
    const json = JSON.stringify({
      document: {
        sections: [{ title: 'S1', items: [{ text: 'Do it', status: 'open' }] }],
      },
    });
    const result = parseJsonImport(json);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('S1');
    expect(result[0].items[0].text).toBe('Do it');
  });

  it('accepts pre-parsed object', () => {
    const result = parseJsonImport({
      document: { sections: [{ title: 'A' }] },
    });
    expect(result).toHaveLength(1);
    expect(result[0].items).toEqual([]);
  });

  it('throws on empty string', () => {
    expect(() => parseJsonImport('')).toThrow(ValidationError);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonImport('{not json')).toThrow(/Invalid JSON/);
  });

  it('throws on null input', () => {
    expect(() => parseJsonImport(null)).toThrow(ValidationError);
  });

  it('throws when document field missing', () => {
    expect(() => parseJsonImport(JSON.stringify({ foo: 'bar' }))).toThrow(
      /missing required "document"/,
    );
  });

  it('throws when sections is not an array', () => {
    expect(() => parseJsonImport(JSON.stringify({ document: { sections: 'nope' } }))).toThrow(
      /missing required "document.sections"/,
    );
  });

  it('defaults title to Untitled and type to text', () => {
    const result = parseJsonImport({ document: { sections: [{}] } });
    expect(result[0].title).toBe('Untitled');
    expect(result[0].type).toBe('text');
  });

  it('preserves optional item fields', () => {
    const result = parseJsonImport({
      document: {
        sections: [{
          title: 'S',
          items: [{ text: 'T', status: 'done', assignee: 'a', priority: 'low', dueDate: '2026-06-01', category: 'bug' }],
        }],
      },
    });
    const item = result[0].items[0];
    expect(item.assignee).toBe('a');
    expect(item.priority).toBe('low');
    expect(item.dueDate).toBe('2026-06-01');
    expect(item.category).toBe('bug');
  });
});

describe('applyImport', () => {
  const mockCreateSection = jest.fn();
  const mockGetSections = jest.fn();
  const mockCreateItem = jest.fn();

  const deps = {
    sectionRepo: {
      createSection: mockCreateSection,
      getSectionsForDocument: mockGetSections,
    },
    itemRepo: { createItem: mockCreateItem },
  };

  beforeEach(() => {
    mockCreateSection.mockReset();
    mockGetSections.mockReset();
    mockCreateItem.mockReset();
  });

  it('creates sections and items, returns counts', async () => {
    mockGetSections.mockResolvedValue([]);
    mockCreateSection.mockResolvedValue({ sectionId: 'new-sec' });
    mockCreateItem.mockResolvedValue(undefined);

    const parsed: ParsedSection[] = [
      { title: 'S1', items: [{ text: 'T1', status: 'open' }, { text: 'T2', status: 'done' }] },
    ];
    const result = await applyImport('doc-1', parsed, deps);
    expect(result).toEqual({ sectionsCreated: 1, itemsCreated: 2 });
    expect(mockCreateSection).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', title: 'S1', sortOrder: 0 }),
    );
  });

  it('continues sortOrder from existing sections', async () => {
    mockGetSections.mockResolvedValue([{ sortOrder: 3 }, { sortOrder: 5 }]);
    mockCreateSection.mockResolvedValue({ sectionId: 'new-sec' });

    await applyImport('doc-1', [{ title: 'New', items: [] }], deps);
    expect(mockCreateSection).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 6 }),
    );
  });

  it('handles empty parsed input', async () => {
    mockGetSections.mockResolvedValue([]);
    const result = await applyImport('doc-1', [], deps);
    expect(result).toEqual({ sectionsCreated: 0, itemsCreated: 0 });
  });

  it('passes assignee and priority through to createItem', async () => {
    mockGetSections.mockResolvedValue([]);
    mockCreateSection.mockResolvedValue({ sectionId: 'sec-new' });
    mockCreateItem.mockResolvedValue(undefined);

    await applyImport('doc-1', [{
      title: 'S',
      items: [{ text: 'Fix', status: 'open', assignee: 'alice', priority: 'high' }],
    }], deps);

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ assignee: 'alice', priority: 'high' }),
    );
  });
});
