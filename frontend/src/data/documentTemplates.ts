// frontend/src/data/documentTemplates.ts
//
// Document type definitions and their default section templates.

import type { Section } from '../types/document';

export interface DocumentTemplate {
  type: string;
  name: string;
  icon: string;
  description: string;
  defaultSections: { type: Section['type']; title: string }[];
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    type: 'meeting',
    name: 'Meeting Notes',
    icon: '\u{1F4DD}',
    description: 'Capture action items and decisions from meetings',
    defaultSections: [
      { type: 'summary', title: 'Executive Summary' },
      { type: 'tasks', title: 'Action Items' },
      { type: 'decisions', title: 'Decisions' },
      { type: 'notes', title: 'Notes' },
    ],
  },
  {
    type: 'sprint',
    name: 'Sprint Planning',
    icon: '\u{1F680}',
    description: 'Plan sprints and track iteration progress',
    defaultSections: [
      { type: 'summary', title: 'Sprint Summary' },
      { type: 'tasks', title: 'Backlog' },
      { type: 'tasks', title: 'Sprint Tasks' },
      { type: 'decisions', title: 'Decisions' },
    ],
  },
  {
    type: 'design',
    name: 'Design Review',
    icon: '\u{1F3A8}',
    description: 'Track design decisions and gather feedback',
    defaultSections: [
      { type: 'summary', title: 'Design Summary' },
      { type: 'decisions', title: 'Design Decisions' },
      { type: 'notes', title: 'Open Questions' },
      { type: 'notes', title: 'Notes' },
    ],
  },
  {
    type: 'project',
    name: 'Project Brief',
    icon: '\u{1F4CB}',
    description: 'Define requirements, scope, and success criteria',
    defaultSections: [
      { type: 'summary', title: 'Executive Summary' },
      { type: 'notes', title: 'Requirements' },
      { type: 'tasks', title: 'Success Criteria' },
      { type: 'notes', title: 'Timeline' },
    ],
  },
  {
    type: 'decision',
    name: 'Decision Log',
    icon: '\u{2696}\u{FE0F}',
    description: 'Record and track organizational decisions',
    defaultSections: [
      { type: 'decisions', title: 'Decisions' },
      { type: 'notes', title: 'Context' },
      { type: 'notes', title: 'Notes' },
    ],
  },
  {
    type: 'retro',
    name: 'Retrospective',
    icon: '\u{1F504}',
    description: 'Reflect on what worked and what to improve',
    defaultSections: [
      { type: 'notes', title: 'What Went Well' },
      { type: 'notes', title: "What Didn't" },
      { type: 'tasks', title: 'Action Items' },
    ],
  },
  {
    type: 'custom',
    name: 'Custom',
    icon: '\u{1F4C4}',
    description: 'Blank document -- add your own sections',
    defaultSections: [],
  },
];
