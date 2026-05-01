// Phase 51 — vitest for TypedDocumentsPage orchestration logic.
//
// Coverage:
//   - Fetches document types on mount and populates the sidebar
//   - Auto-selects the first type
//   - Shows error state when type fetch fails
//   - Shows empty state when no types exist
//   - Selecting a type renders the form and document list
//   - Display mode picker filters visible fields in the instance list

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TypedDocumentsPage } from './TypedDocumentsPage';
import type { ApiDocumentType, TypedDocument } from '../../hooks/useTypedDocuments';

const TYPE_A: ApiDocumentType = {
  typeId: 'type-a',
  name: 'Article',
  description: 'A news article',
  icon: '📰',
  fields: [
    { fieldId: 'f-title', name: 'Title', fieldType: 'text', widget: 'text_field', cardinality: 1, required: true, helpText: '', displayModes: { full: true, teaser: true, list: true } },
    { fieldId: 'f-body', name: 'Body', fieldType: 'long_text', widget: 'textarea', cardinality: 1, required: false, helpText: '', displayModes: { full: true, teaser: false, list: false } },
  ],
  createdBy: 'admin',
  createdAt: '2026-04-30T00:00:00Z',
  updatedAt: '2026-04-30T00:00:00Z',
};

const TYPE_B: ApiDocumentType = {
  typeId: 'type-b',
  name: 'Note',
  description: '',
  icon: '📝',
  fields: [
    { fieldId: 'f-text', name: 'Text', fieldType: 'text', widget: 'text_field', cardinality: 1, required: true, helpText: '' },
  ],
  createdBy: 'admin',
  createdAt: '2026-04-30T00:00:00Z',
  updatedAt: '2026-04-30T00:00:00Z',
};

const DOC_1: TypedDocument = {
  documentId: 'doc-1',
  typeId: 'type-a',
  values: { 'f-title': 'Hello World', 'f-body': 'Article body text' },
  createdBy: 'user-1',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

// Mock the useTypedDocuments hook
const mockCreateDocument = vi.fn().mockResolvedValue({});
let mockDocuments: TypedDocument[] = [];
let mockDocsLoading = false;
let mockDocsError: string | null = null;

vi.mock('../../hooks/useTypedDocuments', async () => {
  const actual = await vi.importActual('../../hooks/useTypedDocuments');
  return {
    ...actual,
    useTypedDocuments: () => ({
      documents: mockDocuments,
      loading: mockDocsLoading,
      error: mockDocsError,
      createDocument: mockCreateDocument,
      refresh: vi.fn(),
    }),
  };
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockDocuments = [];
  mockDocsLoading = false;
  mockDocsError = null;
  mockCreateDocument.mockReset().mockResolvedValue({});

  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockTypesResponse(types: ApiDocumentType[]): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: types }),
  } as Response);
}

function mockTypesError(status: number): void {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
  } as Response);
}

describe('TypedDocumentsPage', () => {
  it('fetches types on mount and renders them in the sidebar', async () => {
    mockTypesResponse([TYPE_A, TYPE_B]);

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('type-type-a')).toBeDefined();
      expect(screen.getByTestId('type-type-b')).toBeDefined();
    });
    expect(screen.getByText('Article')).toBeDefined();
    expect(screen.getByText('Note')).toBeDefined();
  });

  it('auto-selects the first type and renders the form', async () => {
    mockTypesResponse([TYPE_A]);
    mockDocuments = [DOC_1];

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('documents-list')).toBeDefined();
    });
    expect(screen.getByText('Article documents (1)')).toBeDefined();
  });

  it('shows error state when type fetch fails', async () => {
    mockTypesError(500);

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('types-error')).toBeDefined();
    });
    expect(screen.getByTestId('types-error').textContent).toContain('500');
  });

  it('shows empty state when no types exist', async () => {
    mockTypesResponse([]);

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('types-empty')).toBeDefined();
    });
    expect(screen.getByText(/No types yet/)).toBeDefined();
  });

  it('shows placeholder when no type is selected and no types exist', async () => {
    mockTypesResponse([]);

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-detail')).toBeDefined();
    });
  });

  it('renders field count badge for each type in the sidebar', async () => {
    mockTypesResponse([TYPE_A, TYPE_B]);

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByText('2 fields')).toBeDefined();
      expect(screen.getByText('1 field')).toBeDefined();
    });
  });

  it('switches selected type when a different sidebar button is clicked', async () => {
    mockTypesResponse([TYPE_A, TYPE_B]);
    mockDocuments = [];

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('type-type-b')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('type-type-b'));

    await waitFor(() => {
      expect(screen.getByText('Note documents (0)')).toBeDefined();
    });
  });

  it('renders document instances with field values', async () => {
    mockTypesResponse([TYPE_A]);
    mockDocuments = [DOC_1];

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('document-doc-1')).toBeDefined();
    });
    expect(screen.getByText('Hello World')).toBeDefined();
    expect(screen.getByText('Article body text')).toBeDefined();
  });

  it('display mode picker filters visible fields in instance list', async () => {
    mockTypesResponse([TYPE_A]);
    mockDocuments = [DOC_1];

    render(<TypedDocumentsPage idToken="test-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('display-mode-picker')).toBeDefined();
    });

    // In 'full' mode (default), both Title and Body should be visible
    expect(screen.getByText('Hello World')).toBeDefined();
    expect(screen.getByText('Article body text')).toBeDefined();

    // Switch to 'teaser' — Body has teaser:false so should disappear
    fireEvent.change(screen.getByTestId('display-mode-picker'), { target: { value: 'teaser' } });

    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeDefined();
      expect(screen.queryByText('Article body text')).toBeNull();
    });
  });

  it('does not fetch types when idToken is null', async () => {
    render(<TypedDocumentsPage idToken={null} />);

    // Should not have called fetch at all
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
