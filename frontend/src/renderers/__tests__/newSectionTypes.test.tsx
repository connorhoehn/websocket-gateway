// Phase 51 / hub#71 — round-trip tests for the three new section
// renderers (File Upload, Diagram, Link Block). Each test wires the
// editor + reader against a tiny stateful host so we can assert that
// what the editor writes lands in the reader's render output.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Section, ViewMode } from '../../types/document';
import FileUploadEditorRenderer from '../file-upload/FileUploadEditorRenderer';
import FileUploadReaderRenderer from '../file-upload/FileUploadReaderRenderer';
import DiagramEditorRenderer from '../diagram/DiagramEditorRenderer';
import DiagramReaderRenderer from '../diagram/DiagramReaderRenderer';
import LinkBlockEditorRenderer from '../link-block/LinkBlockEditorRenderer';
import LinkBlockReaderRenderer from '../link-block/LinkBlockReaderRenderer';

afterEach(() => cleanup());

function makeSection(type: string, metadata: Record<string, unknown> = {}): Section {
  return {
    id: `s-${type}`,
    type: 'custom',
    title: `${type} section`,
    collapsed: false,
    items: [],
    sectionType: type,
    metadata,
  };
}

// Minimal harness: holds the section in state and forwards onUpdateSection
// patches into it so the editor's writes are visible to the reader.
function Harness({
  initial,
  EditorRenderer,
  ReaderRenderer,
  showReader = true,
}: {
  initial: Section;
  EditorRenderer: React.ComponentType<any>;
  ReaderRenderer: React.ComponentType<any>;
  showReader?: boolean;
}) {
  const [section, setSection] = useState<Section>(initial);
  const onUpdateSection = (patch: Partial<Section>): void => {
    setSection((prev) => ({ ...prev, ...patch, metadata: { ...(prev.metadata ?? {}), ...(patch.metadata ?? {}) } }));
  };
  return (
    <div>
      <EditorRenderer
        section={section}
        viewMode={'editor' as ViewMode}
        editable={true}
        onUpdateSection={onUpdateSection}
      />
      {showReader && (
        <ReaderRenderer
          section={section}
          viewMode={'reader' as ViewMode}
          editable={false}
        />
      )}
    </div>
  );
}

// jsdom's FileReader doesn't read file contents predictably; stub it so
// the editor's onload fires synchronously with a known data-URL.
function stubFileReader(dataUrl = 'data:application/octet-stream;base64,AAAA') {
  class StubFileReader {
    public result: string | null = null;
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    readAsDataURL(_file: File) {
      this.result = dataUrl;
      // Schedule async to mimic real FileReader; vitest awaits microtasks.
      Promise.resolve().then(() => this.onload?.());
    }
  }
  vi.stubGlobal('FileReader', StubFileReader);
}

describe('FileUpload renderer (hub#71)', () => {
  it('editor empty state shows the upload prompt; reader shows empty placeholder', () => {
    render(
      <Harness
        initial={makeSection('file-upload')}
        EditorRenderer={FileUploadEditorRenderer}
        ReaderRenderer={FileUploadReaderRenderer}
      />,
    );
    expect(screen.getByTestId('file-upload-empty-s-file-upload')).toBeInTheDocument();
    expect(screen.getByTestId('file-upload-reader-empty-s-file-upload')).toBeInTheDocument();
  });

  it('round-trips: select a file in editor → reader shows download link', async () => {
    stubFileReader('data:text/plain;base64,SGVsbG8=');
    render(
      <Harness
        initial={makeSection('file-upload')}
        EditorRenderer={FileUploadEditorRenderer}
        ReaderRenderer={FileUploadReaderRenderer}
      />,
    );

    const file = new File(['Hello'], 'notes.txt', { type: 'text/plain' });
    const input = screen.getByTestId('file-upload-input-s-file-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    const link = await screen.findByTestId('file-upload-link-s-file-upload');
    expect(link).toHaveTextContent('Download notes.txt');
  });
});

describe('Diagram renderer (hub#71)', () => {
  it('editor empty state shows the upload prompt; reader shows empty placeholder', () => {
    render(
      <Harness
        initial={makeSection('diagram')}
        EditorRenderer={DiagramEditorRenderer}
        ReaderRenderer={DiagramReaderRenderer}
      />,
    );
    expect(screen.getByTestId('diagram-empty-s-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-reader-empty-s-diagram')).toBeInTheDocument();
  });

  it('round-trips: select an image → reader renders an <img> with the data-URL', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0K';
    stubFileReader(dataUrl);
    render(
      <Harness
        initial={makeSection('diagram')}
        EditorRenderer={DiagramEditorRenderer}
        ReaderRenderer={DiagramReaderRenderer}
      />,
    );

    const file = new File(['png-bytes'], 'arch.png', { type: 'image/png' });
    const input = screen.getByTestId('diagram-input-s-diagram') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    const readerFig = await screen.findByTestId('diagram-reader-s-diagram');
    await waitFor(() => {
      const img = readerFig.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe(dataUrl);
    });
  });
});

describe('Link Block renderer (hub#71)', () => {
  it('editor empty state has the empty marker + reader shows empty placeholder', () => {
    render(
      <Harness
        initial={makeSection('link-block')}
        EditorRenderer={LinkBlockEditorRenderer}
        ReaderRenderer={LinkBlockReaderRenderer}
      />,
    );
    expect(screen.getByTestId('link-block-empty-s-link-block')).toBeInTheDocument();
    expect(screen.getByTestId('link-block-reader-empty-s-link-block')).toBeInTheDocument();
  });

  it('round-trips: add a link → fill label + url → reader renders an <a>', () => {
    render(
      <Harness
        initial={makeSection('link-block')}
        EditorRenderer={LinkBlockEditorRenderer}
        ReaderRenderer={LinkBlockReaderRenderer}
      />,
    );

    fireEvent.click(screen.getByTestId('link-block-add-s-link-block'));
    fireEvent.change(screen.getByTestId('link-block-label-s-link-block-0'), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByTestId('link-block-url-s-link-block-0'), { target: { value: 'https://example.com/docs' } });

    const list = screen.getByTestId('link-block-reader-s-link-block');
    const anchor = list.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe('https://example.com/docs');
    expect(anchor!.textContent).toBe('Docs');
  });

  it('removes a link via the × button', () => {
    render(
      <Harness
        initial={makeSection('link-block', { links: [{ label: 'A', url: 'https://a' }] })}
        EditorRenderer={LinkBlockEditorRenderer}
        ReaderRenderer={LinkBlockReaderRenderer}
      />,
    );

    expect(screen.getByTestId('link-block-reader-s-link-block')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('link-block-remove-s-link-block-0'));
    expect(screen.getByTestId('link-block-reader-empty-s-link-block')).toBeInTheDocument();
  });
});
