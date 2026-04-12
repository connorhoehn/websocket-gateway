// frontend/src/data/documentTemplates.ts
//
// Document type definitions and their default section templates.

import type { Section, SectionType, ViewMode } from '../types/document';

export interface DefaultSectionDef {
  type: Section['type'];
  title: string;
  sectionType?: SectionType;              // renderer hint for specialized UIs
  placeholder?: string;                   // guidance text when section is empty
  metadata?: Record<string, unknown>;     // default metadata for this section
}

export interface DocumentTemplate {
  type: string;
  name: string;
  icon: string;
  description: string;
  defaultSections: DefaultSectionDef[];
  supportedModes?: ViewMode[];            // which view modes make sense (defaults to all)
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    type: 'meeting',
    name: 'Meeting Notes',
    icon: '\u{1F4DD}',
    description: 'Capture action items and decisions from meetings',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'Agenda', sectionType: 'rich-text', placeholder: 'Meeting agenda items...' },
      { type: 'notes', title: 'Discussion', sectionType: 'rich-text', placeholder: 'Key discussion points...' },
      { type: 'tasks', title: 'Action Items', sectionType: 'tasks' },
      { type: 'decisions', title: 'Decisions', sectionType: 'decisions' },
    ],
  },
  {
    type: 'sprint',
    name: 'Sprint Planning',
    icon: '\u{1F680}',
    description: 'Plan sprints and track iteration progress',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Sprint Goals', placeholder: 'What are we committing to this sprint?' },
      { type: 'tasks', title: 'Backlog Items', sectionType: 'tasks' },
      { type: 'notes', title: 'Capacity', sectionType: 'rich-text', placeholder: 'Team availability and velocity...' },
      { type: 'notes', title: 'Risks', sectionType: 'rich-text', placeholder: 'Dependencies, unknowns, concerns...' },
    ],
  },
  {
    type: 'design',
    name: 'Design Review',
    icon: '\u{1F3A8}',
    description: 'Track design decisions and gather feedback',
    supportedModes: ['editor', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Overview', placeholder: 'Describe the design being reviewed...' },
      { type: 'notes', title: 'Design Options', sectionType: 'rich-text', placeholder: 'Options and trade-offs...' },
      { type: 'notes', title: 'Feedback', sectionType: 'rich-text', placeholder: 'Reviewer feedback...' },
      { type: 'decisions', title: 'Decision', sectionType: 'decisions' },
    ],
  },
  {
    type: 'project',
    name: 'Project Brief',
    icon: '\u{1F4CB}',
    description: 'Define requirements, scope, and success criteria',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Objective', placeholder: 'High-level project objective...' },
      { type: 'notes', title: 'Scope', sectionType: 'rich-text', placeholder: 'What is in and out of scope...' },
      { type: 'notes', title: 'Timeline', sectionType: 'rich-text', placeholder: 'Key milestones and dates...' },
      { type: 'notes', title: 'Resources', sectionType: 'rich-text', placeholder: 'Team, budget, tools...' },
      { type: 'notes', title: 'Risks', sectionType: 'rich-text', placeholder: 'Known risks and mitigations...' },
    ],
  },
  {
    type: 'decision',
    name: 'Decision Log',
    icon: '\u{2696}\u{FE0F}',
    description: 'Record and track organizational decisions',
    supportedModes: ['editor', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'Context', sectionType: 'rich-text', placeholder: 'What prompted this decision?' },
      { type: 'notes', title: 'Options Considered', sectionType: 'rich-text', placeholder: 'List the alternatives evaluated...' },
      { type: 'decisions', title: 'Decision', sectionType: 'decisions' },
      { type: 'notes', title: 'Rationale', sectionType: 'rich-text', placeholder: 'Why this option was chosen...' },
    ],
  },
  {
    type: 'retro',
    name: 'Retrospective',
    icon: '\u{1F504}',
    description: 'Reflect on what worked and what to improve',
    supportedModes: ['editor', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'What Went Well', sectionType: 'rich-text', placeholder: 'Celebrate wins...' },
      { type: 'notes', title: "What Didn't", sectionType: 'rich-text', placeholder: 'Identify pain points...' },
      { type: 'tasks', title: 'Start', sectionType: 'tasks', placeholder: 'Things to start doing...' },
      { type: 'tasks', title: 'Stop', sectionType: 'tasks', placeholder: 'Things to stop doing...' },
      { type: 'tasks', title: 'Continue', sectionType: 'tasks', placeholder: 'Things to keep doing...' },
    ],
  },
  {
    type: 'standup',
    name: 'Standup Log',
    icon: '\u{1F9CD}',
    description: 'Daily standup updates per team member',
    supportedModes: ['editor', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'Yesterday', sectionType: 'checklist', placeholder: 'What did you accomplish?' },
      { type: 'notes', title: 'Today', sectionType: 'checklist', placeholder: 'What will you work on?' },
      { type: 'notes', title: 'Blockers', sectionType: 'rich-text', placeholder: 'Any impediments?' },
    ],
  },
  {
    type: 'incident',
    name: 'Incident Report',
    icon: '\u{1F6A8}',
    description: 'Document incidents with timeline and root cause',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Summary', placeholder: 'Describe what happened...', metadata: { severity: 'unknown' } },
      { type: 'notes', title: 'Timeline', sectionType: 'rich-text', placeholder: 'Chronological sequence of events...' },
      { type: 'notes', title: 'Impact', sectionType: 'rich-text', placeholder: 'Users, systems, and services affected...' },
      { type: 'notes', title: 'Root Cause', sectionType: 'rich-text', placeholder: 'What caused the incident...' },
      { type: 'tasks', title: 'Remediation', sectionType: 'tasks' },
      { type: 'notes', title: 'Lessons Learned', sectionType: 'rich-text', placeholder: 'What we can do better next time...' },
    ],
  },
  {
    type: 'onboarding',
    name: 'Onboarding Checklist',
    icon: '\u{1F44B}',
    description: 'New hire onboarding tasks and resources',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'tasks', title: 'Day 1', sectionType: 'checklist', placeholder: 'First day setup and orientation...' },
      { type: 'tasks', title: 'Week 1', sectionType: 'checklist', placeholder: 'First week goals and introductions...' },
      { type: 'tasks', title: 'Week 2', sectionType: 'checklist', placeholder: 'Second week deeper dives...' },
      { type: 'tasks', title: 'Month 1', sectionType: 'checklist', placeholder: 'First month milestones...' },
    ],
  },
  {
    type: 'rfc',
    name: 'RFC / Proposal',
    icon: '\u{1F4E8}',
    description: 'Request for comments on a technical or process proposal',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Problem Statement', placeholder: 'What problem are we solving?' },
      { type: 'notes', title: 'Background', sectionType: 'rich-text', placeholder: 'Context and prior art...' },
      { type: 'notes', title: 'Proposed Solution', sectionType: 'rich-text', placeholder: 'Detailed proposal...' },
      { type: 'notes', title: 'Alternatives', sectionType: 'rich-text', placeholder: 'Other approaches considered...' },
      { type: 'notes', title: 'Open Questions', sectionType: 'rich-text', placeholder: 'Unresolved questions for discussion...' },
    ],
  },
  {
    type: 'one-on-one',
    name: '1:1 Notes',
    icon: '\u{1F91D}',
    description: 'Structure recurring 1:1 conversations',
    supportedModes: ['editor', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'Agenda', sectionType: 'rich-text', placeholder: 'Topics to cover...' },
      { type: 'notes', title: 'Discussion Topics', sectionType: 'rich-text', placeholder: 'Notes from discussion...' },
      { type: 'tasks', title: 'Action Items', sectionType: 'tasks' },
      { type: 'tasks', title: 'Follow-ups', sectionType: 'tasks', placeholder: 'Items to revisit next time...' },
    ],
  },
  {
    type: 'runbook',
    name: 'Runbook',
    icon: '\u{1F4D6}',
    description: 'Operational procedures with ordered steps',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'Prerequisites', sectionType: 'rich-text', placeholder: 'Required access, tools, and context...' },
      { type: 'tasks', title: 'Steps', sectionType: 'checklist' },
      { type: 'tasks', title: 'Verification', sectionType: 'checklist', placeholder: 'How to confirm success...' },
      { type: 'notes', title: 'Rollback', sectionType: 'rich-text', placeholder: 'Steps to undo if something goes wrong...' },
    ],
  },
  {
    type: 'changelog',
    name: 'Changelog',
    icon: '\u{1F4E6}',
    description: 'Track version changes and release notes',
    supportedModes: ['editor', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Latest Version', placeholder: 'Version number and release date...' },
      { type: 'notes', title: 'Changes', sectionType: 'rich-text', placeholder: 'What changed in this version...' },
      { type: 'notes', title: 'Contributors', sectionType: 'rich-text' },
      { type: 'notes', title: 'Previous Versions', sectionType: 'rich-text' },
    ],
  },
  {
    type: 'interview',
    name: 'Interview Scorecard',
    icon: '\u{1F3AF}',
    description: 'Structured candidate evaluation framework',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'summary', title: 'Candidate Info', placeholder: 'Name, role, date, interviewers...' },
      { type: 'notes', title: 'Technical', sectionType: 'rich-text', placeholder: 'Technical skills assessment...' },
      { type: 'notes', title: 'Problem Solving', sectionType: 'rich-text', placeholder: 'Analytical and problem-solving ability...' },
      { type: 'notes', title: 'Communication', sectionType: 'rich-text', placeholder: 'Communication clarity and style...' },
      { type: 'notes', title: 'Culture Fit', sectionType: 'rich-text', placeholder: 'Values alignment and team fit...' },
      { type: 'decisions', title: 'Overall Recommendation', sectionType: 'decisions' },
    ],
  },
  {
    type: 'custom',
    name: 'Custom',
    icon: '\u{1F4C4}',
    description: 'Blank document -- add your own sections',
    supportedModes: ['editor', 'ack', 'reader'],
    defaultSections: [
      { type: 'notes', title: 'Section 1', sectionType: 'rich-text' },
    ],
  },
];
