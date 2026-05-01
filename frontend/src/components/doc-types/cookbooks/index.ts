// frontend/src/components/doc-types/cookbooks/index.ts
//
// Document type cookbook templates — prebuilt DocumentType shapes that users
// can install from the CookbooksModal. Each cookbook's `build()` returns a
// fresh DocumentType payload (sans id/timestamps) with newly-minted field
// IDs. The caller is responsible for persisting via createType().
//
// Modeled after the pipeline templates gallery
// (src/components/pipelines/templates/index.ts).

import type { DocumentType, DocumentTypeField } from '../../../types/documentType';

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

export interface DocumentTypeCookbook {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: CookbookCategory;
  tags: string[];
  build(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>;
}

export type CookbookCategory =
  | 'Engineering'
  | 'Operations'
  | 'People'
  | 'Sales & CRM'
  | 'Product'
  | 'Finance'
  | 'Legal'
  | 'General';

export const COOKBOOK_CATEGORIES: CookbookCategory[] = [
  'General',
  'Engineering',
  'Operations',
  'Product',
  'People',
  'Sales & CRM',
  'Finance',
  'Legal',
];

// ---------------------------------------------------------------------------
// Field factory — consistent shape with randomUUID ids
// ---------------------------------------------------------------------------

function field(
  name: string,
  sectionType: string,
  opts: Partial<Pick<DocumentTypeField, 'required' | 'defaultCollapsed' | 'placeholder' | 'hiddenInModes'>> = {},
): DocumentTypeField {
  return {
    id: crypto.randomUUID(),
    name,
    sectionType,
    required: opts.required ?? false,
    defaultCollapsed: opts.defaultCollapsed ?? false,
    placeholder: opts.placeholder ?? '',
    hiddenInModes: opts.hiddenInModes ?? [],
    rendererOverrides: {},
  };
}

// ---------------------------------------------------------------------------
// 1. Bug Report
// ---------------------------------------------------------------------------

function buildBugReport(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Bug Report',
    description: 'Track bugs with severity, reproduction steps, and resolution notes.',
    icon: '\u{1F41B}',
    fields: [
      field('Title', 'text', { required: true }),
      field('Severity', 'text', { required: true, placeholder: 'Critical / High / Medium / Low' }),
      field('Status', 'text', { required: true, placeholder: 'Open / In Progress / Resolved / Won\'t Fix' }),
      field('Reported By', 'text', { required: true }),
      field('Reported Date', 'date', { required: true }),
      field('Assigned To', 'text'),
      field('Environment', 'text', { placeholder: 'Production / Staging / Development / Local' }),
      field('Steps to Reproduce', 'rich-text', { required: true, placeholder: 'Detailed steps to reproduce the issue...' }),
      field('Expected Behavior', 'rich-text', { required: true, placeholder: 'What should happen...' }),
      field('Actual Behavior', 'rich-text', { required: true, placeholder: 'What actually happens...' }),
      field('Screenshots / Evidence', 'rich-text', { placeholder: 'Paste screenshots or supporting evidence...' }),
      field('Root Cause', 'rich-text', { placeholder: 'What caused the issue...', defaultCollapsed: true }),
      field('Resolution Notes', 'rich-text', { placeholder: 'How the issue was resolved...', defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. Employee Onboarding Checklist
// ---------------------------------------------------------------------------

function buildOnboarding(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Employee Onboarding Checklist',
    description: 'New hire onboarding tasks, milestones, and equipment tracking.',
    icon: '\u{1F44B}',
    fields: [
      field('Employee Name', 'text', { required: true }),
      field('Start Date', 'date', { required: true }),
      field('Department', 'text', { required: true, placeholder: 'Engineering / Product / Design / Sales / Marketing / Operations / HR / Finance' }),
      field('Manager', 'text', { required: true }),
      field('Role Title', 'text', { required: true }),
      field('Equipment Issued', 'boolean'),
      field('Accounts Created', 'boolean'),
      field('Orientation Complete', 'boolean'),
      field('First Week Goals', 'rich-text', { placeholder: 'Goals for the first week...' }),
      field('30-Day Milestones', 'rich-text', { placeholder: 'What should be accomplished by day 30...' }),
      field('60-Day Milestones', 'rich-text', { placeholder: 'What should be accomplished by day 60...', defaultCollapsed: true }),
      field('90-Day Review Date', 'date'),
      field('Mentor Assigned', 'text'),
      field('Notes', 'rich-text'),
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. Invoice
// ---------------------------------------------------------------------------

function buildInvoice(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Invoice',
    description: 'Track invoices with line items, amounts, and payment status.',
    icon: '\u{1F4B0}',
    fields: [
      field('Invoice Number', 'text', { required: true, placeholder: 'INV-0001' }),
      field('Issue Date', 'date', { required: true }),
      field('Due Date', 'date', { required: true }),
      field('Status', 'text', { required: true, placeholder: 'Draft / Sent / Paid / Overdue / Void' }),
      field('Client Name', 'text', { required: true }),
      field('Client Email', 'text'),
      field('Line Items', 'rich-text', { required: true, placeholder: 'Description of goods or services...' }),
      field('Subtotal', 'number', { required: true }),
      field('Tax Rate (%)', 'number'),
      field('Tax Amount', 'number'),
      field('Total Amount', 'number', { required: true }),
      field('Currency', 'text', { required: true, placeholder: 'USD / EUR / GBP / CAD / AUD' }),
      field('Payment Terms', 'text', { placeholder: 'Net 15 / Net 30 / Net 60 / Due on Receipt' }),
      field('Payment Method', 'text', { placeholder: 'Wire / ACH / Check / Credit Card' }),
      field('Notes', 'rich-text'),
      field('Paid Date', 'date', { defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. Meeting Notes
// ---------------------------------------------------------------------------

function buildMeetingNotes(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Meeting Notes',
    description: 'Capture agendas, discussion points, decisions, and action items.',
    icon: '\u{1F4DD}',
    fields: [
      field('Meeting Title', 'text', { required: true }),
      field('Date', 'date', { required: true }),
      field('Meeting Type', 'text', { required: true, placeholder: 'Standup / Sprint Planning / Retro / 1:1 / All Hands / Design Review / Ad Hoc' }),
      field('Attendees', 'text', { placeholder: 'Comma-separated names' }),
      field('Facilitator', 'text'),
      field('Agenda', 'rich-text', { placeholder: 'Topics to cover...' }),
      field('Discussion Notes', 'rich-text', { required: true, placeholder: 'Key discussion points...' }),
      field('Action Items', 'rich-text', { placeholder: 'Who does what by when...' }),
      field('Decisions Made', 'rich-text', { placeholder: 'Decisions reached during the meeting...' }),
      field('Follow-Up Date', 'date'),
      field('Recording Link', 'text', { placeholder: 'URL to meeting recording' }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. Sales Lead / CRM Contact
// ---------------------------------------------------------------------------

function buildSalesLead(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Sales Lead',
    description: 'Track leads through the sales pipeline with deal values and follow-ups.',
    icon: '\u{1F4BC}',
    fields: [
      field('Contact Name', 'text', { required: true }),
      field('Company', 'text', { required: true }),
      field('Email', 'text', { required: true, placeholder: 'email@example.com' }),
      field('Phone', 'text'),
      field('Lead Source', 'text', { required: true, placeholder: 'Inbound / Outbound / Referral / Event / Website / Cold Call' }),
      field('Stage', 'text', { required: true, placeholder: 'New / Contacted / Qualified / Proposal / Negotiation / Closed Won / Closed Lost' }),
      field('Deal Value', 'number'),
      field('Currency', 'text', { placeholder: 'USD / EUR / GBP / CAD' }),
      field('Expected Close Date', 'date'),
      field('Last Contact Date', 'date'),
      field('Next Follow-Up', 'date'),
      field('Owner', 'text'),
      field('Notes', 'rich-text'),
      field('Lost Reason', 'text', { placeholder: 'Price / Competitor / Timing / No Budget / No Response / Other', defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. Incident Report
// ---------------------------------------------------------------------------

function buildIncidentReport(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Incident Report',
    description: 'Document incidents with severity, timeline, root cause, and remediation.',
    icon: '\u{1F6A8}',
    fields: [
      field('Incident Title', 'text', { required: true }),
      field('Severity', 'text', { required: true, placeholder: 'SEV1 / SEV2 / SEV3 / SEV4' }),
      field('Status', 'text', { required: true, placeholder: 'Investigating / Identified / Monitoring / Resolved / Postmortem' }),
      field('Detected At', 'date', { required: true }),
      field('Resolved At', 'date', { defaultCollapsed: true }),
      field('Duration', 'text', { defaultCollapsed: true, placeholder: 'e.g. 2h 15m' }),
      field('Incident Commander', 'text', { required: true }),
      field('Services Affected', 'text', { placeholder: 'Comma-separated service names' }),
      field('Customer Impact', 'rich-text', { required: true, placeholder: 'Describe the user-facing impact...' }),
      field('Timeline', 'rich-text', { required: true, placeholder: 'Chronological sequence of events...' }),
      field('Root Cause', 'rich-text', { placeholder: 'What caused the incident...', defaultCollapsed: true }),
      field('Remediation Steps', 'rich-text', { placeholder: 'Steps taken to resolve...' }),
      field('Action Items', 'rich-text', { placeholder: 'Follow-up tasks to prevent recurrence...', defaultCollapsed: true }),
      field('Lessons Learned', 'rich-text', { placeholder: 'What we can do better next time...', defaultCollapsed: true }),
      field('Related Incidents', 'text', { placeholder: 'Links to related incident reports' }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 7. RFC / Technical Proposal
// ---------------------------------------------------------------------------

function buildRFC(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'RFC / Technical Proposal',
    description: 'Request for comments with problem statement, proposed solution, and alternatives.',
    icon: '\u{1F4E8}',
    fields: [
      field('RFC Title', 'text', { required: true }),
      field('Author', 'text', { required: true }),
      field('Status', 'text', { required: true, placeholder: 'Draft / In Review / Accepted / Rejected / Superseded' }),
      field('Created Date', 'date', { required: true }),
      field('Decision Date', 'date', { defaultCollapsed: true }),
      field('Reviewers', 'text', { placeholder: 'Comma-separated reviewer names' }),
      field('Problem Statement', 'rich-text', { required: true, placeholder: 'What problem are we solving?' }),
      field('Proposed Solution', 'rich-text', { required: true, placeholder: 'Detailed proposal...' }),
      field('Alternatives Considered', 'rich-text', { placeholder: 'Other approaches evaluated...' }),
      field('Technical Design', 'rich-text', { placeholder: 'Architecture, data flow, API changes...' }),
      field('Migration Plan', 'rich-text', { placeholder: 'How to roll out the change...', defaultCollapsed: true }),
      field('Risks', 'rich-text', { placeholder: 'Known risks and mitigations...' }),
      field('Open Questions', 'rich-text', { placeholder: 'Unresolved questions for discussion...' }),
      field('Decision', 'rich-text', { placeholder: 'Final decision and rationale...', defaultCollapsed: true }),
      field('Superseded By', 'text', { placeholder: 'Link to successor RFC', defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 8. Product Feature Request
// ---------------------------------------------------------------------------

function buildFeatureRequest(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Feature Request',
    description: 'Capture feature requests with user stories, priority, and effort estimates.',
    icon: '\u{1F4A1}',
    fields: [
      field('Feature Title', 'text', { required: true }),
      field('Requested By', 'text', { required: true }),
      field('Priority', 'text', { required: true, placeholder: 'Critical / High / Medium / Low / Nice to Have' }),
      field('Status', 'text', { required: true, placeholder: 'New / Under Review / Planned / In Progress / Shipped / Declined' }),
      field('Category', 'text', { placeholder: 'UX / Performance / Integration / New Capability / Infrastructure' }),
      field('Target Release', 'text'),
      field('User Story', 'rich-text', { required: true, placeholder: 'As a [user], I want [goal] so that [benefit]' }),
      field('Problem Description', 'rich-text', { required: true, placeholder: 'What problem does this solve?' }),
      field('Proposed Solution', 'rich-text', { placeholder: 'How should this work?' }),
      field('Success Metrics', 'rich-text', { placeholder: 'How will we measure success?' }),
      field('Effort Estimate', 'text', { placeholder: 'XS / S / M / L / XL' }),
      field('Business Value', 'text', { placeholder: 'Revenue / Retention / Adoption / Compliance / Internal Efficiency' }),
      field('Dependencies', 'rich-text', { defaultCollapsed: true }),
      field('Decline Reason', 'rich-text', { placeholder: 'Why was this declined?', defaultCollapsed: true }),
      field('Ship Date', 'date', { defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 9. Contract / Agreement
// ---------------------------------------------------------------------------

function buildContract(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Contract / Agreement',
    description: 'Track contracts with counterparty, terms, renewal dates, and status.',
    icon: '\u{1F4DC}',
    fields: [
      field('Contract Title', 'text', { required: true }),
      field('Contract Type', 'text', { required: true, placeholder: 'NDA / MSA / SOW / SLA / Employment / Vendor / Licensing / Other' }),
      field('Status', 'text', { required: true, placeholder: 'Draft / In Review / Pending Signature / Active / Expired / Terminated' }),
      field('Counterparty', 'text', { required: true }),
      field('Effective Date', 'date', { required: true }),
      field('Expiration Date', 'date'),
      field('Auto-Renew', 'boolean'),
      field('Renewal Term', 'text', { placeholder: 'Monthly / Quarterly / Annual / Biennial', defaultCollapsed: true }),
      field('Contract Value', 'number'),
      field('Currency', 'text', { placeholder: 'USD / EUR / GBP / CAD' }),
      field('Payment Terms', 'text', { placeholder: 'Net 15 / Net 30 / Net 60 / Upfront' }),
      field('Internal Owner', 'text', { required: true }),
      field('Key Terms', 'rich-text', { placeholder: 'Important clauses and obligations...' }),
      field('Termination Clause', 'rich-text', { defaultCollapsed: true }),
      field('Notes', 'rich-text'),
      field('Termination Date', 'date', { defaultCollapsed: true }),
      field('Termination Reason', 'rich-text', { placeholder: 'Why was this terminated?', defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 10. Sprint Retrospective
// ---------------------------------------------------------------------------

function buildRetro(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Sprint Retrospective',
    description: 'Reflect on the sprint with what went well, what didn\'t, and action items.',
    icon: '\u{1F504}',
    fields: [
      field('Sprint Name', 'text', { required: true }),
      field('Sprint Dates', 'text', { required: true, placeholder: 'Jan 6 – Jan 17' }),
      field('Facilitator', 'text'),
      field('Team', 'text', { required: true }),
      field('Velocity', 'number'),
      field('Planned Points', 'number'),
      field('Completed Points', 'number'),
      field('What Went Well', 'rich-text', { required: true, placeholder: 'Celebrate wins...' }),
      field('What Didn\'t Go Well', 'rich-text', { required: true, placeholder: 'Identify pain points...' }),
      field('Start Doing', 'rich-text', { placeholder: 'New practices to adopt...' }),
      field('Stop Doing', 'rich-text', { placeholder: 'Practices to drop...' }),
      field('Continue Doing', 'rich-text', { placeholder: 'Practices to keep...' }),
      field('Action Items', 'rich-text', { required: true, placeholder: 'Specific follow-up tasks...' }),
      field('Action Item Owners', 'text', { placeholder: 'Comma-separated names' }),
      field('Follow-Up Date', 'date'),
      field('Overall Sentiment', 'text', { required: true, placeholder: 'Great / Good / Mixed / Rough' }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 11. Job Posting
// ---------------------------------------------------------------------------

function buildJobPosting(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Job Posting',
    description: 'Job listings with requirements, compensation, and hiring status.',
    icon: '\u{1F4CB}',
    fields: [
      field('Job Title', 'text', { required: true }),
      field('Department', 'text', { required: true, placeholder: 'Engineering / Product / Design / Sales / Marketing / Operations / HR / Finance / Legal' }),
      field('Location', 'text', { required: true, placeholder: 'Remote / Hybrid / On-site' }),
      field('Office Location', 'text', { defaultCollapsed: true }),
      field('Employment Type', 'text', { required: true, placeholder: 'Full-time / Part-time / Contract / Intern' }),
      field('Level', 'text', { required: true, placeholder: 'Junior / Mid / Senior / Staff / Principal / Director / VP' }),
      field('Status', 'text', { required: true, placeholder: 'Draft / Open / On Hold / Filled / Closed' }),
      field('Hiring Manager', 'text', { required: true }),
      field('Salary Range Min', 'number'),
      field('Salary Range Max', 'number'),
      field('Currency', 'text', { placeholder: 'USD / EUR / GBP / CAD' }),
      field('Job Description', 'rich-text', { required: true, placeholder: 'Role overview and responsibilities...' }),
      field('Requirements', 'rich-text', { required: true, placeholder: 'Must-have qualifications...' }),
      field('Nice to Have', 'rich-text', { placeholder: 'Preferred but not required...' }),
      field('Benefits', 'rich-text', { placeholder: 'Compensation and perks...' }),
      field('Posted Date', 'date'),
      field('Closing Date', 'date'),
      field('Filled By', 'text', { defaultCollapsed: true }),
      field('Filled Date', 'date', { defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 12. Vendor Evaluation
// ---------------------------------------------------------------------------

function buildVendorEvaluation(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Vendor Evaluation',
    description: 'Evaluate vendors with scoring, compliance checks, and recommendations.',
    icon: '\u{1F50D}',
    fields: [
      field('Vendor Name', 'text', { required: true }),
      field('Category', 'text', { required: true, placeholder: 'SaaS / Infrastructure / Consulting / Hardware / Staffing / Other' }),
      field('Evaluation Status', 'text', { required: true, placeholder: 'Researching / In Trial / Evaluating / Approved / Rejected / Active Vendor' }),
      field('Evaluator', 'text', { required: true }),
      field('Evaluation Date', 'date', { required: true }),
      field('Website', 'text'),
      field('Primary Contact', 'text'),
      field('Annual Cost', 'number'),
      field('Currency', 'text', { placeholder: 'USD / EUR / GBP / CAD' }),
      field('Contract Length', 'text', { placeholder: 'Monthly / Annual / Multi-Year' }),
      field('Security Review Complete', 'boolean'),
      field('SOC2 Compliant', 'boolean'),
      field('GDPR Compliant', 'boolean'),
      field('Strengths', 'rich-text', { placeholder: 'Key advantages...' }),
      field('Weaknesses', 'rich-text', { placeholder: 'Gaps and concerns...' }),
      field('Integration Requirements', 'rich-text', { placeholder: 'Technical integration needs...' }),
      field('Score (1–10)', 'number'),
      field('Recommendation', 'rich-text', { placeholder: 'Final recommendation...' }),
      field('Rejection Reason', 'rich-text', { placeholder: 'Why was this vendor rejected?', defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 13. Project Status Report
// ---------------------------------------------------------------------------

function buildStatusReport(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Project Status Report',
    description: 'Weekly project status with health indicators, accomplishments, and risks.',
    icon: '\u{1F4CA}',
    fields: [
      field('Project Name', 'text', { required: true }),
      field('Reporting Period', 'text', { required: true, placeholder: 'Week of Jan 6, 2025' }),
      field('Project Lead', 'text', { required: true }),
      field('Overall Status', 'text', { required: true, placeholder: 'On Track / At Risk / Blocked / Complete' }),
      field('Health: Scope', 'text', { required: true, placeholder: 'Green / Yellow / Red' }),
      field('Health: Timeline', 'text', { required: true, placeholder: 'Green / Yellow / Red' }),
      field('Health: Budget', 'text', { required: true, placeholder: 'Green / Yellow / Red' }),
      field('Percent Complete', 'number'),
      field('Summary', 'rich-text', { required: true, placeholder: 'High-level status overview...' }),
      field('Accomplishments This Period', 'rich-text', { required: true, placeholder: 'What was delivered...' }),
      field('Planned Next Period', 'rich-text', { required: true, placeholder: 'What\'s coming up...' }),
      field('Risks & Issues', 'rich-text', { placeholder: 'Active risks and open issues...' }),
      field('Blockers', 'rich-text', { placeholder: 'Blocking items requiring escalation...', defaultCollapsed: true }),
      field('Decisions Needed', 'rich-text', { placeholder: 'Pending decisions from stakeholders...' }),
      field('Budget Spent', 'number'),
      field('Budget Remaining', 'number'),
      field('Target Completion Date', 'date'),
      field('Stakeholder Notes', 'rich-text', { defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// 14. Change Request
// ---------------------------------------------------------------------------

function buildChangeRequest(): Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Change Request',
    description: 'Formalized change management with risk assessment and rollback plans.',
    icon: '\u{1F504}',
    fields: [
      field('Change Title', 'text', { required: true }),
      field('Change ID', 'text', { required: true, placeholder: 'CR-0001' }),
      field('Requester', 'text', { required: true }),
      field('Request Date', 'date', { required: true }),
      field('Priority', 'text', { required: true, placeholder: 'Emergency / High / Medium / Low' }),
      field('Status', 'text', { required: true, placeholder: 'Submitted / Under Review / Approved / Scheduled / In Progress / Completed / Rolled Back / Rejected' }),
      field('Change Type', 'text', { required: true, placeholder: 'Standard / Normal / Emergency' }),
      field('Systems Affected', 'text', { placeholder: 'Comma-separated system names' }),
      field('Description of Change', 'rich-text', { required: true, placeholder: 'What is being changed and why...' }),
      field('Business Justification', 'rich-text', { required: true, placeholder: 'Why this change is needed...' }),
      field('Risk Assessment', 'text', { required: true, placeholder: 'Low / Medium / High / Critical' }),
      field('Risk Mitigation', 'rich-text', { placeholder: 'Steps to reduce risk...', defaultCollapsed: true }),
      field('Rollback Plan', 'rich-text', { required: true, placeholder: 'How to revert if something goes wrong...' }),
      field('Scheduled Date', 'date', { defaultCollapsed: true }),
      field('Implementation Notes', 'rich-text', { placeholder: 'Notes from the change window...', defaultCollapsed: true }),
      field('Approver', 'text'),
      field('Approval Date', 'date', { defaultCollapsed: true }),
      field('Post-Implementation Review', 'rich-text', { placeholder: 'Review after the change is complete...', defaultCollapsed: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Export — ordered by category, then alphabetically
// ---------------------------------------------------------------------------

export const documentTypeCookbooks: DocumentTypeCookbook[] = [
  // General
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'Capture agendas, discussion points, decisions, and action items.',
    icon: '\u{1F4DD}',
    category: 'General',
    tags: ['meetings', 'notes', 'action items', 'decisions'],
    build: buildMeetingNotes,
  },
  // Engineering
  {
    id: 'bug-report',
    name: 'Bug Report',
    description: 'Track bugs with severity, reproduction steps, and resolution notes.',
    icon: '\u{1F41B}',
    category: 'Engineering',
    tags: ['bugs', 'qa', 'testing', 'defects'],
    build: buildBugReport,
  },
  {
    id: 'rfc',
    name: 'RFC / Technical Proposal',
    description: 'Request for comments with problem statement, proposed solution, and alternatives.',
    icon: '\u{1F4E8}',
    category: 'Engineering',
    tags: ['rfc', 'proposal', 'architecture', 'design'],
    build: buildRFC,
  },
  {
    id: 'sprint-retro',
    name: 'Sprint Retrospective',
    description: 'Reflect on the sprint with what went well, what didn\'t, and action items.',
    icon: '\u{1F504}',
    category: 'Engineering',
    tags: ['agile', 'sprint', 'retro', 'retrospective'],
    build: buildRetro,
  },
  // Operations
  {
    id: 'incident-report',
    name: 'Incident Report',
    description: 'Document incidents with severity, timeline, root cause, and remediation.',
    icon: '\u{1F6A8}',
    category: 'Operations',
    tags: ['incidents', 'postmortem', 'sev', 'outage'],
    build: buildIncidentReport,
  },
  {
    id: 'vendor-evaluation',
    name: 'Vendor Evaluation',
    description: 'Evaluate vendors with scoring, compliance checks, and recommendations.',
    icon: '\u{1F50D}',
    category: 'Operations',
    tags: ['vendors', 'procurement', 'evaluation', 'compliance'],
    build: buildVendorEvaluation,
  },
  {
    id: 'change-request',
    name: 'Change Request',
    description: 'Formalized change management with risk assessment and rollback plans.',
    icon: '\u{1F504}',
    category: 'Operations',
    tags: ['change', 'itil', 'rollback', 'risk'],
    build: buildChangeRequest,
  },
  // Product
  {
    id: 'feature-request',
    name: 'Feature Request',
    description: 'Capture feature requests with user stories, priority, and effort estimates.',
    icon: '\u{1F4A1}',
    category: 'Product',
    tags: ['features', 'product', 'backlog', 'user stories'],
    build: buildFeatureRequest,
  },
  {
    id: 'status-report',
    name: 'Project Status Report',
    description: 'Weekly project status with health indicators, accomplishments, and risks.',
    icon: '\u{1F4CA}',
    category: 'Product',
    tags: ['status', 'project', 'reporting', 'weekly'],
    build: buildStatusReport,
  },
  // People
  {
    id: 'onboarding',
    name: 'Employee Onboarding',
    description: 'New hire onboarding tasks, milestones, and equipment tracking.',
    icon: '\u{1F44B}',
    category: 'People',
    tags: ['onboarding', 'hr', 'new hire', 'checklist'],
    build: buildOnboarding,
  },
  {
    id: 'job-posting',
    name: 'Job Posting',
    description: 'Job listings with requirements, compensation, and hiring status.',
    icon: '\u{1F4CB}',
    category: 'People',
    tags: ['hiring', 'recruiting', 'jobs', 'positions'],
    build: buildJobPosting,
  },
  // Sales & CRM
  {
    id: 'sales-lead',
    name: 'Sales Lead',
    description: 'Track leads through the sales pipeline with deal values and follow-ups.',
    icon: '\u{1F4BC}',
    category: 'Sales & CRM',
    tags: ['sales', 'crm', 'leads', 'pipeline', 'deals'],
    build: buildSalesLead,
  },
  // Finance
  {
    id: 'invoice',
    name: 'Invoice',
    description: 'Track invoices with line items, amounts, and payment status.',
    icon: '\u{1F4B0}',
    category: 'Finance',
    tags: ['invoices', 'billing', 'payments', 'accounting'],
    build: buildInvoice,
  },
  // Legal
  {
    id: 'contract',
    name: 'Contract / Agreement',
    description: 'Track contracts with counterparty, terms, renewal dates, and status.',
    icon: '\u{1F4DC}',
    category: 'Legal',
    tags: ['contracts', 'legal', 'agreements', 'nda', 'sow'],
    build: buildContract,
  },
];
