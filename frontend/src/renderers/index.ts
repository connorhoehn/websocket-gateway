// Central registration barrel — import once to register all field type definitions
// and section renderers. SectionBlock and reader components import from here to
// trigger side-effect registration before calling getRenderer() or getFieldTypes().

import { registerRenderer, registerFieldType } from './registry';

import tasksDef from './tasks/definition';
import richTextDef from './rich-text/definition';
import decisionsDef from './decisions/definition';
import checklistDef from './checklist/definition';
import fileUploadDef from './file-upload/definition';
import diagramDef from './diagram/definition';
import linkBlockDef from './link-block/definition';

import DefaultRenderer from './default/DefaultRenderer';
import RichTextEditorRenderer from './rich-text/RichTextEditorRenderer';
import RichTextReaderRenderer from './rich-text/RichTextReaderRenderer';
import TasksEditorRenderer from './tasks/TasksEditorRenderer';
import TasksReaderRenderer from './tasks/TasksReaderRenderer';
import ChecklistEditorRenderer from './checklist/ChecklistEditorRenderer';
import ChecklistReaderRenderer from './checklist/ChecklistReaderRenderer';
import DecisionsEditorRenderer from './decisions/DecisionsEditorRenderer';
import DecisionsReaderRenderer from './decisions/DecisionsReaderRenderer';
import FileUploadEditorRenderer from './file-upload/FileUploadEditorRenderer';
import FileUploadReaderRenderer from './file-upload/FileUploadReaderRenderer';
import DiagramEditorRenderer from './diagram/DiagramEditorRenderer';
import DiagramReaderRenderer from './diagram/DiagramReaderRenderer';
import LinkBlockEditorRenderer from './link-block/LinkBlockEditorRenderer';
import LinkBlockReaderRenderer from './link-block/LinkBlockReaderRenderer';

// Field type definitions (metadata + renderer key manifests)
registerFieldType(tasksDef);
registerFieldType(richTextDef);
registerFieldType(decisionsDef);
registerFieldType(checklistDef);
// Phase 51 / hub#66 — new section types. Renderers fall through to
// DefaultRenderer (registered with the '*' wildcard above) until
// dedicated editor/reader components ship as follow-ups.
registerFieldType(fileUploadDef);
registerFieldType(diagramDef);
registerFieldType(linkBlockDef);

// Renderer components per (sectionType × viewMode)
registerRenderer('*', '*', DefaultRenderer);

registerRenderer('rich-text', 'editor', RichTextEditorRenderer);
registerRenderer('rich-text', 'ack',    RichTextReaderRenderer);
registerRenderer('rich-text', 'reader', RichTextReaderRenderer);

registerRenderer('tasks', 'editor', TasksEditorRenderer);
registerRenderer('tasks', 'ack',    TasksReaderRenderer);
registerRenderer('tasks', 'reader', TasksReaderRenderer);

registerRenderer('checklist', 'editor', ChecklistEditorRenderer);
registerRenderer('checklist', 'ack',    ChecklistReaderRenderer);
registerRenderer('checklist', 'reader', ChecklistReaderRenderer);

registerRenderer('decisions', 'editor', DecisionsEditorRenderer);
registerRenderer('decisions', 'ack',    DecisionsReaderRenderer);
registerRenderer('decisions', 'reader', DecisionsReaderRenderer);

// Phase 51 / hub#71 — File Upload / Diagram / Link Block.
registerRenderer('file-upload', 'editor', FileUploadEditorRenderer);
registerRenderer('file-upload', 'ack',    FileUploadReaderRenderer);
registerRenderer('file-upload', 'reader', FileUploadReaderRenderer);

registerRenderer('diagram', 'editor', DiagramEditorRenderer);
registerRenderer('diagram', 'ack',    DiagramReaderRenderer);
registerRenderer('diagram', 'reader', DiagramReaderRenderer);

registerRenderer('link-block', 'editor', LinkBlockEditorRenderer);
registerRenderer('link-block', 'ack',    LinkBlockReaderRenderer);
registerRenderer('link-block', 'reader', LinkBlockReaderRenderer);

export {
  registerRenderer,
  getRenderer,
  listRegisteredRenderers,
  registerFieldType,
  getFieldTypes,
  getFieldType,
} from './registry';
