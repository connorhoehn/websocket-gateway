// frontend/src/components/SocialPanel.tsx
//
// Social Profile section card — all sub-components co-located as unexported internals.
// Only SocialPanel is exported. Uses mock data; connect to social API for live data.

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Visibility = 'public' | 'private';
type FollowState = 'not-following' | 'following' | 'pending';

interface UserProfile {
  id: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  visibility: Visibility;
  followersCount?: number;
  followingCount?: number;
  friendsCount?: number;
  followState?: FollowState;
}

// ---------------------------------------------------------------------------
// Mock data constants (exact values from UI-SPEC — do not alter)
// ---------------------------------------------------------------------------

const CURRENT_USER: UserProfile = {
  id: 'user-001',
  displayName: 'Alex Chen',
  bio: 'Building real-time systems. Interested in distributed systems and collaborative tools.',
  avatarUrl: null,
  visibility: 'public',
  followersCount: 42,
  followingCount: 31,
  friendsCount: 18,
};

const MOCK_USERS: UserProfile[] = [
  { id: 'user-002', displayName: 'Jordan Rivera', bio: 'Full-stack developer. React, Node, AWS.', avatarUrl: null, visibility: 'public', followState: 'following' },
  { id: 'user-003', displayName: 'Sam Patel', bio: 'DevOps and platform engineering.', avatarUrl: null, visibility: 'public', followState: 'not-following' },
  { id: 'user-004', displayName: 'Morgan Lee', bio: 'UX designer and front-end engineer.', avatarUrl: null, visibility: 'private', followState: 'following' },
  { id: 'user-005', displayName: 'Casey Kim', bio: 'Open source contributor.', avatarUrl: null, visibility: 'public', followState: 'not-following' },
];

// Social graph tabs for viewer (user-001):
// Followers: user-002, user-003
// Following: user-002, user-004
// Friends (mutual): user-002 only
const TAB_FOLLOWERS = MOCK_USERS.filter(u => ['user-002', 'user-003'].includes(u.id));
const TAB_FOLLOWING = MOCK_USERS.filter(u => ['user-002', 'user-004'].includes(u.id));
const TAB_FRIENDS = MOCK_USERS.filter(u => ['user-002'].includes(u.id));

// ---------------------------------------------------------------------------
// MockDataBanner (internal)
// ---------------------------------------------------------------------------

function MockDataBanner() {
  return (
    <div style={{
      background: '#fefce8',
      border: '1px solid #fde68a',
      borderRadius: 8,
      padding: '8px 16px',
      marginBottom: 16,
      fontSize: 14,
      color: '#92400e',
    }}>
      Demo mode — using mock data. Connect to the social API to go live.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar (internal)
// ---------------------------------------------------------------------------

function Avatar({ user, size }: { user: UserProfile; size: 32 | 48 }) {
  const initials = user.displayName.slice(0, 2).toUpperCase();
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size === 48 ? 16 : 12,
    fontWeight: 600,
    color: '#374151',
    flexShrink: 0,
    overflow: 'hidden',
  };
  if (user.avatarUrl) {
    return (
      <div style={style}>
        <img
          src={user.avatarUrl}
          alt={`${user.displayName}'s avatar`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }
  return (
    <div style={style} aria-label={`Avatar placeholder for ${user.displayName}`}>
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FollowButton (internal)
// ---------------------------------------------------------------------------

interface FollowButtonProps {
  targetUser: UserProfile;
  followState: FollowState;
  compact?: boolean;
  onFollowChange: (userId: string, newState: FollowState) => void;
}

function FollowButton({ targetUser, followState, compact = false, onFollowChange }: FollowButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const height = compact ? 28 : 36;

  const buttonStyle = (state: FollowState): React.CSSProperties => {
    const base: React.CSSProperties = {
      height,
      borderRadius: 8,
      fontSize: 14,
      cursor: 'pointer',
      minWidth: 88,
      padding: '0 16px',
      border: 'none',
    };
    if (state === 'not-following') return { ...base, background: '#646cff', color: '#ffffff', fontWeight: 600 };
    if (state === 'following') return { ...base, background: '#ffffff', color: '#374151', fontWeight: 400, border: '1px solid #e2e8f0' };
    return { ...base, background: '#f1f5f9', color: '#64748b', fontWeight: 400, border: '1px solid #e2e8f0' };
  };

  const handleFollow = () => {
    onFollowChange(targetUser.id, 'pending');
    setTimeout(() => {
      onFollowChange(targetUser.id, 'following');
    }, 400);
  };

  const handleUnfollowClick = () => setShowConfirm(true);
  const handleKeepFollowing = () => setShowConfirm(false);
  const handleConfirmUnfollow = () => {
    setShowConfirm(false);
    onFollowChange(targetUser.id, 'not-following');
  };

  if (followState === 'not-following') {
    return (
      <button
        style={buttonStyle('not-following')}
        onClick={handleFollow}
        aria-label={`Follow ${targetUser.displayName}`}
      >
        Follow
      </button>
    );
  }

  if (followState === 'pending') {
    return (
      <button style={buttonStyle('pending')} disabled aria-label={`Follow ${targetUser.displayName}`}>
        Following\u2026
      </button>
    );
  }

  // following state
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        style={buttonStyle('following')}
        onClick={handleUnfollowClick}
        aria-label={`Unfollow ${targetUser.displayName}`}
      >
        Following
      </button>
      {showConfirm && (
        <div role="group" aria-label="Confirm unfollow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: '#374151', marginRight: 4 }}>
            Unfollow {targetUser.displayName}?
          </span>
          <button
            onClick={handleKeepFollowing}
            style={{ height: 36, borderRadius: 8, fontSize: 14, padding: '0 12px', background: '#ffffff', color: '#374151', border: '1px solid #e2e8f0', cursor: 'pointer' }}
          >
            Keep Following
          </button>
          <button
            onClick={handleConfirmUnfollow}
            style={{ height: 36, borderRadius: 8, fontSize: 14, padding: '0 12px', background: '#dc2626', color: '#ffffff', border: 'none', cursor: 'pointer' }}
          >
            Unfollow
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileCard (internal)
// ---------------------------------------------------------------------------

interface ProfileCardProps {
  user: UserProfile;
  isOwnProfile: boolean;
  onSave: (updates: Partial<UserProfile>) => void;
}

function ProfileCard({ user, isOwnProfile, onSave }: ProfileCardProps) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [visibility, setVisibility] = useState<Visibility>(user.visibility);
  const [saving, setSaving] = useState(false);

  // Reset form fields when user prop changes
  useEffect(() => {
    setDisplayName(user.displayName);
    setBio(user.bio);
    setAvatarUrl(user.avatarUrl ?? '');
    setVisibility(user.visibility);
  }, [user]);

  const privacyBadgeStyle = (v: Visibility): React.CSSProperties => v === 'public'
    ? { background: '#f0fdf4', color: '#16a34a', fontSize: 12, padding: '2px 8px', borderRadius: 4 }
    : { background: '#f1f5f9', color: '#64748b', fontSize: 12, padding: '2px 8px', borderRadius: 4 };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      onSave({ displayName, bio, avatarUrl: avatarUrl || null, visibility });
      setSaving(false);
      setEditing(false);
    }, 300);
  };

  if (editing) {
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
    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 14, color: '#374151', display: 'block', marginBottom: 4 }}>Display name</label>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value.slice(0, 50))}
            placeholder="Your name"
            maxLength={50}
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 14, color: '#374151', display: 'block', marginBottom: 4 }}>Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, 160))}
            placeholder="Tell people a bit about yourself (max 160 characters)"
            maxLength={160}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 14, color: '#374151', display: 'block', marginBottom: 4 }}>Avatar URL</label>
          <input
            value={avatarUrl}
            onChange={e => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div role="radiogroup" aria-label="Profile visibility" style={{ display: 'flex', gap: 8 }}>
            {(['public', 'private'] as Visibility[]).map(v => (
              <button
                key={v}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              height: 36,
              background: '#646cff',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            {saving ? 'Saving\u2026' : 'Save Changes'}
          </button>
          <button
            onClick={() => setEditing(false)}
            style={{ fontSize: 14, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
          >
            Discard Changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <Avatar user={user} size={48} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 600, color: '#0f172a' }}>{user.displayName}</span>
            <span style={privacyBadgeStyle(user.visibility)}>
              {user.visibility === 'public' ? 'Public' : 'Private'}
            </span>
          </div>
          <p style={{ fontSize: 16, color: '#374151', margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            {user.bio}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 14, color: '#64748b', marginBottom: 12 }}>
        <span><strong style={{ color: '#0f172a' }}>{user.followersCount}</strong> Followers</span>
        <span><strong style={{ color: '#0f172a' }}>{user.followingCount}</strong> Following</span>
        <span><strong style={{ color: '#0f172a' }}>{user.friendsCount}</strong> Friends</span>
      </div>
      {isOwnProfile && (
        <button
          onClick={() => setEditing(true)}
          style={{ fontSize: 14, color: '#646cff', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          Edit profile
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SocialGraphPanel (internal)
// ---------------------------------------------------------------------------

type TabKey = 'followers' | 'following' | 'friends';

interface SocialGraphPanelProps {
  followers: UserProfile[];
  following: UserProfile[];
  friends: UserProfile[];
  followStates: Record<string, FollowState>;
  onFollowChange: (userId: string, newState: FollowState) => void;
}

function SocialGraphPanel({ followers, following, friends, followStates, onFollowChange }: SocialGraphPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('followers');

  const tabs: { key: TabKey; label: string; users: UserProfile[] }[] = [
    { key: 'followers', label: `Followers (${followers.length})`, users: followers },
    { key: 'following', label: `Following (${following.length})`, users: following },
    { key: 'friends', label: `Friends (${friends.length})`, users: friends },
  ];

  const emptyStates: Record<TabKey, { heading: string; body: string }> = {
    followers: { heading: 'No followers yet', body: "When someone follows you, they'll appear here." },
    following: { heading: 'Not following anyone yet', body: 'Find people to follow from the profile list above.' },
    friends: { heading: 'No mutual friends yet', body: 'Mutual follows become friends. Start by following someone.' },
  };

  const activeUsers = tabs.find(t => t.key === activeTab)?.users ?? [];

  return (
    <div style={{ marginTop: 16 }}>
      {/* Tab bar */}
      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 12 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 400,
              color: activeTab === tab.key ? '#0f172a' : '#64748b',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #646cff' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        aria-label={activeTab}
        style={{ minHeight: 120 }}
      >
        {activeUsers.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              {emptyStates[activeTab].heading}
            </div>
            <div style={{ fontSize: 14, color: '#9ca3af' }}>
              {emptyStates[activeTab].body}
            </div>
          </div>
        ) : (
          <div>
            {activeUsers.map(user => (
              <div
                key={user.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 56,
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <Avatar user={user} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, color: '#0f172a' }}>{user.displayName}</div>
                  <div style={{ fontSize: 14, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                    {user.visibility === 'private' ? (
                      <em style={{ color: '#9ca3af' }}>This profile is private.</em>
                    ) : user.bio}
                  </div>
                </div>
                <FollowButton
                  targetUser={user}
                  followState={followStates[user.id] ?? 'not-following'}
                  compact
                  onFollowChange={onFollowChange}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SocialPanel (exported)
// ---------------------------------------------------------------------------

export function SocialPanel() {
  const [currentUser, setCurrentUser] = useState<UserProfile>(CURRENT_USER);

  // Follow state map — tracks follow state for all other users
  const initialFollowStates: Record<string, FollowState> = {};
  MOCK_USERS.forEach(u => { initialFollowStates[u.id] = u.followState ?? 'not-following'; });
  const [followStates, setFollowStates] = useState<Record<string, FollowState>>(initialFollowStates);

  // Derived social graph from follow states
  // Following = users where followState is 'following'
  const followingUsers = MOCK_USERS.filter(u => followStates[u.id] === 'following');
  // Followers tab = fixed mock (user-002, user-003 follow viewer)
  const followerUsers = TAB_FOLLOWERS;
  // Friends = intersection of followingUsers and followerUsers (by id)
  const followerIds = new Set(followerUsers.map(u => u.id));
  const friendUsers = followingUsers.filter(u => followerIds.has(u.id));

  const handleFollowChange = (userId: string, newState: FollowState) => {
    setFollowStates(prev => ({ ...prev, [userId]: newState }));
  };

  const handleProfileSave = (updates: Partial<UserProfile>) => {
    setCurrentUser(prev => ({ ...prev, ...updates }));
  };

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
      <h2 style={sectionHeaderStyle}>Social Profile</h2>
      <MockDataBanner />
      <ProfileCard
        user={currentUser}
        isOwnProfile={true}
        onSave={handleProfileSave}
      />
      <SocialGraphPanel
        followers={followerUsers}
        following={followingUsers}
        friends={friendUsers}
        followStates={followStates}
        onFollowChange={handleFollowChange}
      />
    </div>
  );
}
