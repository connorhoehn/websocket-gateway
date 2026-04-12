# Export Research: Tiptap/ProseMirror CRDT Document Export

**Researched:** 2026-04-11
**Domain:** Document export (Markdown, PDF, DOCX), CRDT metadata stripping, Markdown import
**Confidence:** HIGH (all recommendations verified against npm registry and official docs)

## Summary

Tiptap now has first-party support for bidirectional Markdown via `@tiptap/markdown` (v3.22.3) and server-side static rendering via `@tiptap/static-renderer` and `@tiptap/html`. For PDF generation, the cleanest path is Tiptap JSON -> HTML (server-side) -> PDF via either `@react-pdf/renderer` (React component tree) or Puppeteer/`@sparticuz/chromium` (highest fidelity, Lambda-compatible). For DOCX, `prosemirror-docx` (v0.6.1) wraps `docx.js` and follows the same serializer pattern as `prosemirror-markdown`. Google Docs compatibility is achieved via DOCX upload to Drive API -- there is no direct Google Docs native format API worth using.

Stripping CRDT metadata is straightforward: Y.js stores collaboration state separately from the ProseMirror document. Calling `editor.getJSON()` or using the static renderer produces clean ProseMirror JSON with zero CRDT artifacts. The export pipeline never touches Y.js internals.

**Primary recommendation:** Use `@tiptap/markdown` for Markdown I/O, `@tiptap/html` + `@react-pdf/renderer` for PDF, and `prosemirror-docx` for DOCX. All are production-grade, server-side capable, and require no browser.

---

## 1. Markdown Export (Tiptap JSON -> Markdown)

### Recommended: `@tiptap/markdown` (Official)

| Property | Value |
|----------|-------|
| Package | `@tiptap/markdown` |
| Version | 3.22.3 (verified 2026-04-11) |
| Confidence | HIGH |

**Key APIs:**
```typescript
import { Markdown } from '@tiptap/markdown'

// In editor config
const editor = new Editor({
  extensions: [StarterKit, Markdown],
})

// Export: JSON -> Markdown
const markdown = editor.markdown.serialize()

// Import: Markdown -> JSON
const json = editor.markdown.parse('# Hello World')

// Set content from markdown
editor.commands.setContent('# Title\n\nBody text', { contentType: 'markdown' })
```

**GFM Task Lists:** Configure with `markedOptions: { gfm: true }` to enable `- [ ]` / `- [x]` syntax. Requires `TaskList` and `TaskItem` extensions.

```typescript
import { Markdown } from '@tiptap/markdown'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'

const editor = new Editor({
  extensions: [
    StarterKit,
    TaskList,
    TaskItem,
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
  ],
})
```

### Alternative: `prosemirror-markdown` (Lower-level)

| Property | Value |
|----------|-------|
| Package | `prosemirror-markdown` |
| Version | 1.13.4 (verified 2026-04-11) |
| Use case | When you need a custom serializer without Tiptap editor instance |

```typescript
import { defaultMarkdownSerializer } from 'prosemirror-markdown'
import { schema } from 'prosemirror-schema-basic'

const doc = schema.nodeFromJSON(prosemirrorJson)
const markdown = defaultMarkdownSerializer.serialize(doc, { tightLists: true })
```

**Tradeoff:** Requires defining custom serializers for non-standard nodes (task lists, etc.). `@tiptap/markdown` handles this automatically for all installed Tiptap extensions.

### Deprecated: `tiptap-markdown` (Community)

Version 0.9.0. Maintainer has stated they will not release v1 since Tiptap now has official markdown support. **Do not use for new projects.**

---

## 2. Server-Side Static Rendering (No Browser Required)

### `@tiptap/html` and `@tiptap/static-renderer`

| Property | Value |
|----------|-------|
| Package | `@tiptap/html` / `@tiptap/static-renderer` |
| Version | 3.22.3 (verified 2026-04-11) |
| Confidence | HIGH |

These are critical for the export pipeline. They render Tiptap JSON to HTML or Markdown **without a browser, DOM, or editor instance**.

```typescript
// Server-side HTML generation (works in Node.js, Lambda, etc.)
import { generateHTML } from '@tiptap/html'  // NOT from @tiptap/core (browser-only)
import StarterKit from '@tiptap/starter-kit'

const html = generateHTML(jsonContent, [StarterKit])
```

```typescript
// Static renderer - more flexible
import { renderToHTMLString, renderToMarkdown } from '@tiptap/static-renderer'

const html = renderToHTMLString({ extensions: [StarterKit], content: jsonContent })
const md = renderToMarkdown(jsonContent, [StarterKit], {})
```

**IMPORTANT:** `generateHTML` from `@tiptap/core` requires a browser DOM. For server-side, always import from `@tiptap/html`.

---

## 3. PDF Export

### Option A: `@react-pdf/renderer` (RECOMMENDED for this project)

| Property | Value |
|----------|-------|
| Package | `@react-pdf/renderer` |
| Version | 4.4.1 (verified 2026-04-11) |
| Weekly downloads | ~1.4M |
| Server-side | Yes (Node.js native) |
| Browser preview | Yes (built-in) |
| Confidence | HIGH |

**Why recommended:** Works both server-side (Lambda) and client-side (in-browser preview). React component model matches this project's stack. No headless browser needed.

```typescript
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'

// Define PDF document as React components
const ExportDocument = ({ content }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.section}>
        <Text>{content.title}</Text>
      </View>
    </Page>
  </Document>
)

// Server-side: generate PDF buffer
const pdfBuffer = await pdf(<ExportDocument content={data} />).toBuffer()

// Client-side: in-browser preview
import { PDFViewer } from '@react-pdf/renderer'
const Preview = () => (
  <PDFViewer width="100%" height="600">
    <ExportDocument content={data} />
  </PDFViewer>
)
```

**Pipeline:** Tiptap JSON -> walk AST -> React PDF components -> PDF buffer/blob

**Limitation:** You must build a mapping from ProseMirror node types to React PDF components. This is a one-time effort but requires handling: paragraphs, headings (h1-h6), bold/italic/code marks, bullet/ordered lists, task lists, code blocks, blockquotes, images, horizontal rules.

### Option B: Puppeteer + `@sparticuz/chromium` (Highest Fidelity)

| Property | Value |
|----------|-------|
| Package | `@sparticuz/chromium` |
| Version | 147.0.0 (verified 2026-04-11) |
| Use case | When CSS styling must match exactly |
| Confidence | HIGH |

```typescript
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  args: chromium.args,
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
})
const page = await browser.newPage()
await page.setContent(htmlString)  // from @tiptap/html
const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true })
await browser.close()
```

**Tradeoffs:**
- Highest CSS fidelity (renders like a real browser)
- Heavy: ~50MB chromium binary, 1.5-2GB Lambda RAM, 10-30s cold start
- `chrome-aws-lambda` is DEPRECATED -- use `@sparticuz/chromium` instead

### Option C: `pdfmake` (JSON-driven, no React needed)

| Property | Value |
|----------|-------|
| Package | `pdfmake` |
| Version | 0.3.7 (verified 2026-04-11) |
| Use case | Simple documents, server-only |

```typescript
import PdfPrinter from 'pdfmake'

const docDefinition = {
  content: [
    { text: 'Heading', fontSize: 18, bold: true },
    { text: 'Body paragraph...' },
    { ul: ['Item 1', 'Item 2'] },
  ],
}
const printer = new PdfPrinter(fonts)
const pdfDoc = printer.createPdfKitDocument(docDefinition)
```

**Tradeoff:** JSON document definition is custom to pdfmake -- requires a separate Tiptap JSON -> pdfmake JSON transformer. Less ecosystem support than `@react-pdf/renderer`.

### Option D: `jsPDF` (Client-side focused)

| Property | Value |
|----------|-------|
| Package | `jspdf` |
| Version | 4.2.1 (verified 2026-04-11) |
| Use case | Simple client-side PDF generation |

**Not recommended** for this use case. jsPDF is primarily client-side and has limited rich text support. Better suited for simple reports/invoices than document export.

### PDF Recommendation Matrix

| Criteria | @react-pdf/renderer | Puppeteer | pdfmake | jsPDF |
|----------|---------------------|-----------|---------|-------|
| Server-side | Yes | Yes | Yes | Limited |
| Browser preview | Yes (PDFViewer) | No | No | No |
| CSS fidelity | Medium | Highest | Low | Low |
| Bundle size | Small | ~50MB | Small | Small |
| Lambda friendly | Yes | Yes (heavy) | Yes | N/A |
| Rich text support | Manual mapping | Full (HTML/CSS) | Manual mapping | Minimal |

**Verdict:** Use `@react-pdf/renderer` for the primary pipeline. It gives you both server-side generation AND in-browser preview with the same React component tree. Fall back to Puppeteer only if CSS fidelity becomes a hard requirement.

---

## 4. DOCX Export (Word / Google Docs Compatible)

### Recommended: `prosemirror-docx`

| Property | Value |
|----------|-------|
| Package | `prosemirror-docx` |
| Version | 0.6.1 (verified 2026-04-11) |
| Confidence | MEDIUM (smaller community, but actively maintained) |

```typescript
import { DocxSerializer, defaultDocxSerializer } from 'prosemirror-docx'
import { Packer } from 'docx'

// Serialize ProseMirror doc to DOCX
const wordDocument = defaultDocxSerializer.serialize(prosemirrorDoc, {
  getImageBuffer: async (src) => fetch(src).then(r => r.arrayBuffer()),
})

// Generate .docx file buffer
const buffer = await Packer.toBuffer(wordDocument)

// Client-side download
const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
```

**Key facts:**
- Write-only (export only, no import)
- Wraps `docx` (docx.js.org) which does the actual DOCX generation
- Follows same serializer pattern as `prosemirror-markdown`
- Supports: headings, paragraphs, lists, bold/italic, images, tables, blockquotes, code blocks

### Alternative: Tiptap Conversion Service (Paid)

Tiptap offers a paid DOCX conversion REST API at `/v2/convert/export`. Supports DOCX, PDF, ODT, EPUB. **Note:** The v1 API is deprecated and will be sunset in 2026. Only use v2.

### Alternative: `docen` (Newer, Less Mature)

| Property | Value |
|----------|-------|
| Package | `docen` |
| Version | 0.0.15 |

Very early stage (v0.0.15). Built on TipTap/ProseMirror with TypeScript. Not production-ready yet.

---

## 5. Stripping CRDT Metadata for Clean Export

**Confidence:** HIGH

This is simpler than expected. Y.js CRDT metadata is stored in the Y.Doc, completely separate from the ProseMirror document state.

### How It Works

```
Y.Doc (CRDT layer)
  └── Y.XmlFragment (mapped to ProseMirror via y-prosemirror)
        └── ProseMirror EditorState.doc (clean document)
```

**Getting clean content:**

```typescript
// Method 1: From editor instance (client-side)
const cleanJson = editor.getJSON()  // No CRDT metadata included
const cleanHtml = editor.getHTML()

// Method 2: From Y.Doc (server-side, e.g., from stored snapshot)
import { yDocToProsemirrorJSON } from 'y-prosemirror'
const json = yDocToProsemirrorJSON(ydoc, 'default')  // Clean ProseMirror JSON

// Method 3: Static rendering from JSON
import { generateHTML } from '@tiptap/html'
const html = generateHTML(cleanJson, extensions)
```

**What you do NOT need to do:**
- No manual metadata stripping
- No walking the tree to remove CRDT fields
- No special "export mode"

The ProseMirror JSON from `editor.getJSON()` or `yDocToProsemirrorJSON()` is already clean. Y.js collaboration metadata (client IDs, version vectors, tombstones) never enters the ProseMirror document structure.

---

## 6. Importing Markdown INTO Tiptap/Y.js

### Client-Side Import (Into Live Editor)

```typescript
// Direct: set editor content from markdown string
editor.commands.setContent(markdownString, { contentType: 'markdown' })

// Partial: insert at cursor position
editor.commands.insertContent('**bold text**', { contentType: 'markdown' })

// At specific position
editor.commands.insertContentAt(10, '## Heading', { contentType: 'markdown' })
```

When the editor is bound to Y.js via `y-prosemirror`, `setContent` automatically propagates to the Y.Doc and syncs to all collaborators.

### Server-Side Import (Into Y.Doc Without Editor)

```typescript
import { Markdown } from '@tiptap/markdown'

// Parse markdown to Tiptap JSON (no editor needed)
// Note: This requires setting up a headless editor or using the static parser
const json = editor.markdown.parse(markdownString)

// Then use Tiptap Collaboration REST API or direct Y.Doc manipulation
// to inject the JSON into the collaborative document
```

For AI-generated content initial import, the recommended flow is:
1. AI generates markdown
2. First client to open the document calls `editor.commands.setContent(aiMarkdown, { contentType: 'markdown' })`
3. Y.js syncs to all other clients

---

## 7. Markdown Parsing Libraries Comparison

| Library | Version | AST Type | GFM | Speed | Use Case |
|---------|---------|----------|-----|-------|----------|
| `marked` | 18.0.0 | Token stream | Yes | Fastest | HTML output, used internally by @tiptap/markdown |
| `remark` / `remark-parse` | 15.0.1 | mdast (full AST) | Via plugins | Medium | AST manipulation, transformation pipelines |
| `markdown-it` | 14.1.1 | Token stream | Via plugins | Fast | Extensible HTML output |

### Recommendation

**Do not add a separate markdown parser.** `@tiptap/markdown` uses `marked` internally. Adding `remark` or `markdown-it` would duplicate functionality.

Only reach for `remark`/`unified` if you need to:
- Transform markdown AST before importing (e.g., strip certain node types)
- Build a custom markdown-to-PDF pipeline that bypasses ProseMirror entirely
- Process markdown outside the editor context (e.g., batch processing)

---

## 8. Rich Text Formatting in Exports

### Formatting Support Matrix

| Format | Bold | Italic | Code | Lists | Task Lists | Headings | Code Blocks | Images | Tables |
|--------|------|--------|------|-------|------------|----------|-------------|--------|--------|
| Markdown (@tiptap/markdown) | Yes (`**`) | Yes (`*`) | Yes (`` ` ``) | Yes | Yes (GFM) | Yes (`#`) | Yes (```) | Yes | Yes (GFM) |
| HTML (@tiptap/html) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| PDF (@react-pdf/renderer) | Manual | Manual | Manual | Manual | Manual | Manual | Manual | Yes | Manual |
| DOCX (prosemirror-docx) | Yes | Yes | Yes | Yes | Partial | Yes | Yes | Yes | Yes |

**"Manual" for PDF** means you must map each ProseMirror node/mark type to React PDF components. Example:

```typescript
const markStyles = {
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: 'Courier', backgroundColor: '#f0f0f0', padding: 2 },
}

function renderNode(node) {
  switch (node.type) {
    case 'heading':
      return <Text style={{ fontSize: 24 - (node.attrs.level * 2) }}>{renderChildren(node)}</Text>
    case 'paragraph':
      return <Text style={styles.paragraph}>{renderChildren(node)}</Text>
    case 'bulletList':
      return <View>{node.content.map(item => renderNode(item))}</View>
    case 'taskItem':
      return <Text>{node.attrs.checked ? '[x]' : '[ ]'} {renderChildren(node)}</Text>
    // ... etc
  }
}
```

---

## 9. Google Drive Integration

### Upload to Google Drive

| Property | Value |
|----------|-------|
| Package | `googleapis` |
| Version | 171.4.0 (verified 2026-04-11) |
| API | Google Drive v3 |
| Auth | OAuth2 or Service Account |

```typescript
import { google } from 'googleapis'

const drive = google.drive({ version: 'v3', auth: oauthClient })

// Upload PDF to Drive
const response = await drive.files.create({
  requestBody: {
    name: 'Document Export.pdf',
    mimeType: 'application/pdf',
    parents: ['folder-id'],  // optional: target folder
  },
  media: {
    mimeType: 'application/pdf',
    body: pdfBuffer,  // Buffer or Readable stream
  },
})

// Upload DOCX (auto-converts to Google Docs format)
const response = await drive.files.create({
  requestBody: {
    name: 'Document Export',
    mimeType: 'application/vnd.google-apps.document',  // Convert to Google Docs
  },
  media: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: docxBuffer,
  },
})
```

**Key insight for Google Docs format:** There is no practical direct API for creating Google Docs native format programmatically. The standard approach is:
1. Generate DOCX using `prosemirror-docx`
2. Upload to Drive with `mimeType: 'application/vnd.google-apps.document'`
3. Google automatically converts DOCX to native Google Docs format

This is how all major editors (Notion, Confluence, etc.) handle Google Docs export.

### Auth Options

| Method | Use Case | Complexity |
|--------|----------|------------|
| OAuth2 (user consent) | Upload to user's own Drive | Medium - requires consent flow |
| Service Account | Upload to shared/org Drive | Low - server-to-server |

---

## 10. In-Browser PDF Preview

### `@react-pdf/renderer` PDFViewer

```typescript
import { PDFViewer } from '@react-pdf/renderer'

function ExportPreview({ content }) {
  return (
    <PDFViewer width="100%" height="600px" showToolbar={true}>
      <ExportDocument content={content} />
    </PDFViewer>
  )
}
```

This renders a live PDF preview in an iframe. Same React components used for server-side generation work here -- single source of truth.

### Alternative: `react-pdf` (for viewing existing PDFs)

| Property | Value |
|----------|-------|
| Package | `react-pdf` (by wojtekmaj) |
| Use case | Displaying an already-generated PDF file |

This is a DIFFERENT package from `@react-pdf/renderer`. It displays existing PDF files, not generates them. Use if you pre-generate the PDF server-side and want to display it.

---

## 11. Streaming Export for Large Documents

For documents over ~100 pages or with many images:

### Approach: Chunked Processing

```typescript
// @react-pdf/renderer supports streaming
import { renderToStream } from '@react-pdf/renderer'

const stream = await renderToStream(<ExportDocument content={largeContent} />)

// Pipe to response or file
stream.pipe(fs.createWriteStream('output.pdf'))
// or
stream.pipe(res)  // Express response
```

### Markdown: Already Fast

Markdown serialization is synchronous string building. Even for very large documents (10,000+ nodes), it completes in milliseconds. No streaming needed.

### DOCX: Buffer-Based

`prosemirror-docx` + `docx` generates in memory. For truly massive documents, consider chunking content into sections and generating per-section, but this is rarely needed.

---

## Recommended Architecture

### Export Pipeline

```
Tiptap Editor (with Y.js)
    |
    ├── editor.getJSON()  ──────────────── Clean ProseMirror JSON
    |                                           |
    ├── editor.markdown.serialize() ────── Markdown string
    |                                           |
    ├── generateHTML(json, extensions) ──── HTML string (server-safe)
    |       |                                   |
    |       ├── @react-pdf/renderer ────── PDF (buffer or preview)
    |       └── Puppeteer (fallback) ───── PDF (high fidelity)
    |                                           |
    └── prosemirror-docx ──────────────── DOCX (Word/Google Docs)
            |
            └── googleapis ────────────── Upload to Google Drive
```

### Import Pipeline (AI Content -> Collaborative Document)

```
AI generates Markdown
    |
    └── editor.commands.setContent(md, { contentType: 'markdown' })
            |
            └── y-prosemirror syncs to Y.Doc
                    |
                    └── All collaborators receive update
```

---

## Standard Stack

### Core Export Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tiptap/markdown` | 3.22.3 | Markdown I/O | Official Tiptap, bidirectional, GFM support |
| `@tiptap/html` | 3.22.3 | Server-side HTML generation | Official, no browser needed |
| `@tiptap/static-renderer` | 3.22.3 | Static rendering (HTML/MD/React) | Official, no editor instance needed |
| `@react-pdf/renderer` | 4.4.1 | PDF generation + browser preview | 1.4M weekly downloads, React native, server+client |
| `prosemirror-docx` | 0.6.1 | DOCX export | Standard ProseMirror pattern, wraps docx.js |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `googleapis` | 171.4.0 | Google Drive upload | When Google Drive integration is needed |
| `@sparticuz/chromium` | 147.0.0 | Lambda Puppeteer | Only if CSS-fidelity PDF is required |
| `docx` | (peer dep) | DOCX file generation | Peer dependency of prosemirror-docx |

### Do Not Use

| Library | Reason |
|---------|--------|
| `tiptap-markdown` | Deprecated, maintainer recommends official @tiptap/markdown |
| `chrome-aws-lambda` | Deprecated, replaced by @sparticuz/chromium |
| `jspdf` | Limited rich text support, not suited for document export |
| `generateHTML` from `@tiptap/core` | Browser-only, will fail on server |

### Installation

```bash
# Core export
npm install @tiptap/markdown @tiptap/html @tiptap/static-renderer

# PDF
npm install @react-pdf/renderer

# DOCX
npm install prosemirror-docx docx

# Google Drive (optional)
npm install googleapis

# Task lists (for GFM checkbox export)
npm install @tiptap/extension-task-list @tiptap/extension-task-item
```

---

## Common Pitfalls

### Pitfall 1: Wrong `generateHTML` Import
**What goes wrong:** Importing `generateHTML` from `@tiptap/core` instead of `@tiptap/html` on the server causes "document is not defined" errors.
**How to avoid:** Always use `import { generateHTML } from '@tiptap/html'` for server-side code.

### Pitfall 2: Missing Extension Registration for Export
**What goes wrong:** Markdown or HTML export silently drops content for unregistered extensions (e.g., task lists export as empty if TaskList extension not included).
**How to avoid:** Pass the SAME extensions array to export functions that you use in the editor.

### Pitfall 3: Assuming CRDT Metadata Needs Stripping
**What goes wrong:** Developers build complex metadata-stripping logic when none is needed.
**How to avoid:** `editor.getJSON()` and `yDocToProsemirrorJSON()` already produce clean output. Y.js metadata never enters ProseMirror JSON.

### Pitfall 4: GFM Not Enabled for Task Lists
**What goes wrong:** Task lists export as plain list items without `- [ ]` / `- [x]` syntax.
**How to avoid:** Configure `Markdown.configure({ markedOptions: { gfm: true } })`.

### Pitfall 5: Using @react-pdf/renderer Text Components Wrong
**What goes wrong:** Nesting `<View>` inside `<Text>` or using HTML-like elements causes silent rendering failures.
**How to avoid:** `@react-pdf/renderer` has its own component model. Only `<Text>` can contain text. `<View>` is like `<div>`. Read the docs carefully.

### Pitfall 6: Puppeteer Lambda Cold Starts
**What goes wrong:** Lambda times out on first PDF generation (Chromium startup takes 5-15s).
**How to avoid:** Allocate 1536-2048MB RAM, set 30s+ timeout, consider provisioned concurrency for frequent use.

---

## Open Questions

1. **Tiptap v3 Markdown Stability**
   - What we know: @tiptap/markdown 3.22.3 is current and works
   - What's unclear: The v3 migration may introduce breaking changes in the markdown API
   - Recommendation: Pin to exact version, test on upgrade

2. **prosemirror-docx Custom Node Support**
   - What we know: Covers basic nodes (headings, lists, images, tables)
   - What's unclear: How well it handles custom Tiptap extensions (task lists specifically)
   - Recommendation: Test task list serialization early; may need custom serializer

3. **Google Drive OAuth Scope for Upload**
   - What we know: `googleapis` supports Drive v3 upload
   - What's unclear: Exact OAuth scopes and consent UX needed for user-facing upload
   - Recommendation: Use `https://www.googleapis.com/auth/drive.file` (narrow scope, only files created by app)

---

## Sources

### Primary (HIGH confidence)
- [Tiptap Markdown Docs](https://tiptap.dev/docs/editor/markdown) - Official bidirectional markdown support
- [Tiptap Static Renderer](https://tiptap.dev/docs/editor/api/utilities/static-renderer) - Server-side rendering
- [Tiptap HTML Utility](https://tiptap.dev/docs/editor/api/utilities/html) - generateHTML server-side
- [@react-pdf/renderer npm](https://www.npmjs.com/package/@react-pdf/renderer) - v4.4.1, 1.4M weekly downloads
- [prosemirror-markdown npm](https://www.npmjs.com/package/prosemirror-markdown) - v1.13.4
- [prosemirror-docx GitHub](https://github.com/curvenote/prosemirror-docx) - v0.6.1
- [Google Drive Upload API](https://developers.google.com/workspace/drive/api/guides/manage-uploads) - Official docs

### Secondary (MEDIUM confidence)
- [Tiptap DOCX Conversion](https://tiptap.dev/docs/conversion/import-export/docx) - Paid service, v1 deprecated
- [@sparticuz/chromium npm](https://www.npmjs.com/package/@sparticuz/chromium) - v147.0.0, replacement for chrome-aws-lambda
- [y-prosemirror GitHub](https://github.com/yjs/y-prosemirror) - yDocToProsemirrorJSON utility

### Tertiary (LOW confidence)
- [docen](https://github.com/DemoMacro/docen) - v0.0.15, too early for production use
