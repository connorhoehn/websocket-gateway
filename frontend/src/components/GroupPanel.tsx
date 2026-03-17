// frontend/src/components/GroupPanel.tsx
//
// Group management section card — all sub-components co-located as unexported internals.
// Only GroupPanel is exported.

import { useState } from 'react';
import { useGroups } from '../hooks/useGroups';
import type { GroupItem, MemberItem } from '../hooks/useGroups';

// ---------------------------------------------------------------------------
// CreateGroupForm (internal)
// ---------------------------------------------------------------------------

interface CreateGroupFormProps {
  onCreate: (name: string, description?: string, visibility?: 'public' | 'private') => Promise<void>;
  onDiscard: () => void;
  loading: boolean;
}

function CreateGroupForm({ onCreate, onDiscard, loading }: CreateGroupFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 14,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#f9fafb',
    color: '#0f172a',
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void onCreate(name.trim(), description.trim() || undefined, visibility);
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 12, padding: '12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 14, color: '#374151', display: 'block', marginBottom: 4 }}>Group name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, 50))}
          placeholder="Group name"
          maxLength={50}
          required
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 14, color: '#374151', display: 'block', marginBottom: 4 }}>Description (optional)</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value.slice(0, 160))}
          placeholder="Describe your group (max 160 characters)"
          maxLength={160}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div role="radiogroup" aria-label="Group visibility" style={{ display: 'flex', gap: 8 }}>
          {(['public', 'private'] as const).map(v => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={visibility === v}
              onClick={() => setVisibility(v)}
              style={{
                padding: '4px 16px',
                borderRadius: 20,
                fontSize: 14,
                cursor: 'pointer',
                border: '1px solid #e2e8f0',
                background: visibility === v ? '#646cff' : '#ffffff',
                color: visibility === v ? '#ffffff' : '#374151',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={!name.trim() || loading}
          style={{
            flex: 1,
            height: 36,
            background: !name.trim() || loading ? '#f1f5f9' : '#646cff',
            color: !name.trim() || loading ? '#9ca3af' : '#ffffff',
            border: !name.trim() || loading ? '1px solid #e2e8f0' : 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: !name.trim() || loading ? 'default' : 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {loading ? 'Creating…' : 'Create Group'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          style={{ fontSize: 14, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          Discard Changes
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// InviteForm (internal)
// ---------------------------------------------------------------------------

interface InviteFormProps {
  groupId: string;
  onInvite: (groupId: string, userId: string) => Promise<void>;
}

function InviteForm({ groupId, onInvite }: InviteFormProps) {
  const [userId, setUserId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) return;
    void onInvite(groupId, userId.trim());
    setUserId('');
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input
        value={userId}
        onChange={e => setUserId(e.target.value)}
        placeholder="User ID to invite"
        style={{
          flex: 1,
          border: '1px solid #d1d5db',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 14,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f9fafb',
          color: '#0f172a',
        }}
      />
      <button
        type="submit"
        disabled={!userId.trim()}
        style={{
          height: 36,
          padding: '0 12px',
          background: !userId.trim() ? '#f1f5f9' : '#646cff',
          color: !userId.trim() ? '#9ca3af' : '#ffffff',
          border: !userId.trim() ? '1px solid #e2e8f0' : 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: !userId.trim() ? 'default' : 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Invite
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// MemberList (internal)
// ---------------------------------------------------------------------------

function MemberList({ members }: { members: MemberItem[] }) {
  const roleBadgeStyle = (role: 'owner' | 'admin' | 'member'): React.CSSProperties => {
    if (role === 'owner') return { background: '#f0fdf4', color: '#16a34a', fontSize: 12, padding: '2px 8px', borderRadius: 4 };
    if (role === 'admin') return { background: '#eff6ff', color: '#3b82f6', fontSize: 12, padding: '2px 8px', borderRadius: 4 };
    return { background: '#f1f5f9', color: '#64748b', fontSize: 12, padding: '2px 8px', borderRadius: 4 };
  };

  return (
    <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8, borderTop: '1px solid #e2e8f0' }}>
      {members.map(member => {
        const initials = (member.displayName ?? member.userId).slice(0, 2).toUpperCase();
        return (
          <div
            key={member.userId}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 48, borderBottom: '1px solid #f1f5f9' }}
          >
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#374151',
              flexShrink: 0,
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, fontSize: 16, color: '#0f172a' }}>
              {member.displayName ?? member.userId}
            </div>
            <span style={roleBadgeStyle(member.role)}>{member.role}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupCard (internal)
// ---------------------------------------------------------------------------

interface GroupCardProps {
  group: GroupItem;
  currentUserId: string | null;
  isSelected: boolean;
  onSelect: (groupId: string) => void;
  onDelete: (groupId: string) => Promise<void>;
}

function GroupCard({ group, currentUserId, isSelected, onSelect, onDelete }: GroupCardProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isOwner = group.ownerId === currentUserId;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', height: 56, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
      onClick={() => onSelect(group.groupId)}
    >
      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
        <div style={{ fontSize: 16, color: '#0f172a', fontWeight: isSelected ? 600 : 400 }}>
          {group.name}
        </div>
        {group.description && (
          <div style={{ fontSize: 14, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {group.description}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 12,
        padding: '2px 8px',
        borderRadius: 4,
        background: group.visibility === 'public' ? '#f0fdf4' : '#f1f5f9',
        color: group.visibility === 'public' ? '#16a34a' : '#64748b',
        flexShrink: 0,
        marginRight: 8,
      }}>
        {group.visibility}
      </span>
      {isOwner && (
        <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {confirmDeleteId === group.groupId ? (
            <div role="group" aria-label="Confirm delete group" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#374151' }}>Delete group?</span>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{ fontSize: 12, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { void onDelete(group.groupId); setConfirmDeleteId(null); }}
                style={{ fontSize: 12, color: '#ffffff', background: '#dc2626', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
              >
                Delete
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteId(group.groupId)}
              style={{ fontSize: 12, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', padding: '4px 8px', fontFamily: 'system-ui, -apple-system, sans-serif' }}
              aria-label={`Delete group ${group.name}`}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupPanel (exported)
// ---------------------------------------------------------------------------

export function GroupPanel({ idToken }: { idToken: string | null }) {
  const {
    groups,
    createGroup,
    deleteGroup,
    inviteUser,
    loadMembers,
    members,
    loading,
  } = useGroups({ idToken });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const currentUserId: string | null = idToken
    ? (() => {
        try {
          return (JSON.parse(atob(idToken.split('.')[1])) as { sub: string }).sub;
        } catch {
          return null;
        }
      })()
    : null;

  const handleCreateGroup = async (name: string, description?: string, visibility?: 'public' | 'private') => {
    await createGroup(name, description, visibility);
    setShowCreateForm(false);
  };

  const handleSelectGroup = (groupId: string) => {
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
    } else {
      setSelectedGroupId(groupId);
      void loadMembers(groupId);
    }
  };

  const selectedGroup = selectedGroupId ? groups.find(g => g.groupId === selectedGroupId) : null;
  const selectedGroupRole = selectedGroup && currentUserId
    ? (selectedGroup.ownerId === currentUserId ? 'owner' : 'member')
    : 'member';

  const sectionCardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '1.25rem',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#64748b',
    margin: '0 0 0.75rem 0',
  };

  return (
    <div style={sectionCardStyle}>
      <h2 style={sectionHeaderStyle}>Groups</h2>
      <button
        onClick={() => setShowCreateForm(prev => !prev)}
        style={{
          width: '100%',
          height: 36,
          marginBottom: 12,
          background: '#646cff',
          color: '#ffffff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Create Group
      </button>
      {showCreateForm && (
        <CreateGroupForm
          onCreate={handleCreateGroup}
          onDiscard={() => setShowCreateForm(false)}
          loading={loading}
        />
      )}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {groups.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              No groups yet
            </div>
            <div style={{ fontSize: 14, color: '#9ca3af' }}>
              Create a group or join a public one.
            </div>
          </div>
        ) : (
          groups.map(group => (
            <GroupCard
              key={group.groupId}
              group={group}
              currentUserId={currentUserId}
              isSelected={selectedGroupId === group.groupId}
              onSelect={handleSelectGroup}
              onDelete={deleteGroup}
            />
          ))
        )}
      </div>
      {selectedGroupId && (
        <div>
          <MemberList members={members} />
          {(selectedGroupRole === 'owner' || selectedGroupRole === 'admin') && (
            <InviteForm groupId={selectedGroupId} onInvite={inviteUser} />
          )}
        </div>
      )}
    </div>
  );
}
