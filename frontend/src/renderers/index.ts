// Central registration barrel — import once to register all field type definitions
// and section renderers. SectionBlock and reader components import from here to
// trigger side-effect registration before calling getRenderer() or getFieldTypes().

import { registerRenderer, registerFieldType } from './registry';

import tasksDef from './tasks/definition';
import richTextDef from './rich-text/definition';
import decisionsDef from './decisions/definition';
import checklistDef from './checklist/definition';

import DefaultRenderer from './default/DefaultRenderer';
import RichTextEditorRenderer from './rich-text/RichTextEditorRenderer';
import RichTextReaderRenderer from './rich-text/RichTextReaderRenderer';
import TasksEditorRenderer from './tasks/TasksEditorRenderer';
import TasksReaderRenderer from './tasks/TasksReaderRenderer';
import ChecklistEditorRenderer from './checklist/ChecklistEditorRenderer';
import ChecklistReaderRenderer from './checklist/ChecklistReaderRenderer';
import DecisionsEditorRenderer from './decisions/DecisionsEditorRenderer';
import DecisionsReaderRenderer from './decisions/DecisionsReaderRenderer';

// Field type definitions (metadata + renderer key manifests)
registerFieldType(tasksDef);
registerFieldType(richTextDef);
registerFieldType(decisionsDef);
registerFieldType(checklistDef);

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

export {
  registerRenderer,
  getRenderer,
  listRegisteredRenderers,
  registerFieldType,
  getFieldTypes,
  getFieldType,
} from './registry';
