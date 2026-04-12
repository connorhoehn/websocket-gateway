// frontend/src/data/userDirectory.ts
//
// Static user directory and groups for @mention autocomplete.
// Phase 1: hardcoded dev users. Phase 2: fetched from Cognito.

export interface DirectoryUser {
  userId: string;
  displayName: string;
  email: string;
  color: string;
  avatar?: string;
}

export interface UserGroup {
  id: string;
  name: string;       // Display name: "Engineering"
  handle: string;     // @handle: "engineering"
  memberIds: string[];
  color: string;
}

// ---------------------------------------------------------------------------
// Dev user directory (all possible dev users)
// ---------------------------------------------------------------------------

export const DEV_USERS: DirectoryUser[] = [
  { userId: 'alice', displayName: 'Alice Chen', email: 'alice.chen@local.dev', color: '#3b82f6' },
  { userId: 'bob', displayName: 'Bob Martinez', email: 'bob.martinez@local.dev', color: '#ef4444' },
  { userId: 'carol', displayName: 'Carol Johnson', email: 'carol.johnson@local.dev', color: '#8b5cf6' },
  { userId: 'dave', displayName: 'Dave Williams', email: 'dave.williams@local.dev', color: '#f59e0b' },
  { userId: 'eve', displayName: 'Eve Thompson', email: 'eve.thompson@local.dev', color: '#10b981' },
  { userId: 'frank', displayName: 'Frank Davis', email: 'frank.davis@local.dev', color: '#ec4899' },
  { userId: 'grace', displayName: 'Grace Wilson', email: 'grace.wilson@local.dev', color: '#6366f1' },
  { userId: 'hank', displayName: 'Hank Anderson', email: 'hank.anderson@local.dev', color: '#14b8a6' },
];

// ---------------------------------------------------------------------------
// Dev groups
// ---------------------------------------------------------------------------

export const DEV_GROUPS: UserGroup[] = [
  {
    id: 'grp-engineering',
    name: 'Engineering',
    handle: 'engineering',
    memberIds: ['alice', 'bob', 'dave', 'frank'],
    color: '#3b82f6',
  },
  {
    id: 'grp-design',
    name: 'Design',
    handle: 'design',
    memberIds: ['carol', 'eve'],
    color: '#8b5cf6',
  },
  {
    id: 'grp-reviewers',
    name: 'Reviewers',
    handle: 'reviewers',
    memberIds: ['alice', 'carol', 'grace'],
    color: '#f59e0b',
  },
  {
    id: 'grp-everyone',
    name: 'Everyone',
    handle: 'everyone',
    memberIds: ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'hank'],
    color: '#6b7280',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function findUserByName(query: string): DirectoryUser[] {
  const q = query.toLowerCase();
  return DEV_USERS.filter(u =>
    u.displayName.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q)
  );
}

export function findGroupByHandle(query: string): UserGroup[] {
  const q = query.toLowerCase();
  return DEV_GROUPS.filter(g =>
    g.handle.toLowerCase().includes(q) ||
    g.name.toLowerCase().includes(q)
  );
}
