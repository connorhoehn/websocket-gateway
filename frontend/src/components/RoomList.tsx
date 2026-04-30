// frontend/src/components/RoomList.tsx
//
// Room list section card — all sub-components co-located as unexported internals.
// Only RoomList is exported. Rooms state is owned by AppLayout (single useRooms instance).

import { useState } from 'react';
import type { RoomItem } from '../hooks/useRooms';
import { useFriends } from '../hooks/useFriends';
import type { PublicProfile } from '../hooks/useFriends';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoomListProps {
  idToken: string | null;
  rooms: RoomItem[];
  createRoom: (name: string) => Promise<void>;
  createDM: (peerId: string) => Promise<void>;
  loading: boolean;
  /** Inline-render an error + retry control instead of the empty state when set. */
  error?: string | null;
  onRetry?: () => void;
  onRoomSelect: (room: RoomItem) => void;
  activeRoomId?: string | null;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// CreateRoomForm (internal)
// ---------------------------------------------------------------------------

interface CreateRoomFormProps {
  onCreate: (name: string) => Promise<void>;
  onDiscard: () => void;
  loading: boolean;
}

function CreateRoomForm({ onCreate, onDiscard, loading }: CreateRoomFormProps) {
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setFormError(null);
    try {
      await onCreate(name.trim());
      setName('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create room');
    }
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ marginBottom: 8, padding: '12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, 50))}
          placeholder="Room name"
          maxLength={50}
          required
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
          disabled={!name.trim() || loading}
          style={{
            height: 36,
            padding: '0 12px',
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
          {loading ? 'Creating…' : 'Create Room'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          style={{ fontSize: 14, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          Cancel
        </button>
      </div>
      {formError && (
        <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {formError}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// DMRoomButton (internal)
// ---------------------------------------------------------------------------

interface DMRoomButtonProps {
  onCreateDM: (peerId: string) => Promise<void>;
  loading: boolean;
  friends: PublicProfile[];
}

function DMRoomButton({ onCreateDM, loading, friends }: DMRoomButtonProps) {
  const [peerId, setPeerId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerId.trim()) return;
    setFormError(null);
    try {
      await onCreateDM(peerId.trim());
      setPeerId('');
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to open DM');
    }
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        style={{
          width: '100%',
          height: 36,
          marginBottom: 12,
          background: '#ffffff',
          color: '#374151',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Open DM
      </button>
    );
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ marginBottom: 12, padding: '12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={peerId}
          onChange={e => setPeerId(e.target.value)}
          disabled={friends.length === 0}
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
        >
          <option value="">{friends.length === 0 ? 'No mutual friends yet' : 'Select a friend\u2026'}</option>
          {friends.map(f => (
            <option key={f.userId} value={f.userId}>{f.displayName}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!peerId.trim() || loading || friends.length === 0}
          style={{
            height: 36,
            padding: '0 12px',
            background: !peerId.trim() || loading ? '#f1f5f9' : '#ffffff',
            color: !peerId.trim() || loading ? '#9ca3af' : '#374151',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 14,
            cursor: !peerId.trim() || loading ? 'default' : 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          Open DM
        </button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          style={{ fontSize: 14, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          Cancel
        </button>
      </div>
      {formError && (
        <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {formError}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// RoomRow (internal — named RoomRow to avoid conflict with RoomItem type)
// ---------------------------------------------------------------------------

interface RoomRowProps {
  room: RoomItem;
  isActive: boolean;
  onClick: () => void;
}

function RoomRow({ room, isActive, onClick }: RoomRowProps) {
  const typeBadgeStyle = (type: RoomItem['type']): React.CSSProperties => {
    if (type === 'standalone') return { background: '#ede9fe', color: '#646cff', fontSize: 12, padding: '2px 8px', borderRadius: 4 };
    if (type === 'group') return { background: '#eff6ff', color: '#3b82f6', fontSize: 12, padding: '2px 8px', borderRadius: 4 };
    return { background: '#f0fdf4', color: '#16a34a', fontSize: 12, padding: '2px 8px', borderRadius: 4 };
  };

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 56,
        borderBottom: '1px solid #f1f5f9',
        cursor: 'pointer',
        paddingLeft: isActive ? 13 : 0,
        paddingRight: 8,
        background: isActive ? '#f1f5f9' : 'transparent',
        borderLeft: isActive ? '3px solid #646cff' : '3px solid transparent',
      }}
    >
      <div style={{ flex: 1, fontSize: 16, color: '#0f172a', fontWeight: isActive ? 600 : 400 }}>
        {room.name}
      </div>
      <span style={typeBadgeStyle(room.type)}>{room.type}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompactRoomRow (internal — sidebar style)
// ---------------------------------------------------------------------------

function CompactRoomRow({ room, isActive, onClick }: RoomRowProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width: '100%', border: 'none', borderRadius: 5,
        padding: '6px 8px', cursor: 'pointer',
        background: isActive ? '#ede9fe' : 'transparent',
        color: isActive ? '#4c1d95' : '#374151',
        fontWeight: isActive ? 600 : 400,
        fontSize: 13, textAlign: 'left',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span style={{ color: isActive ? '#646cff' : '#94a3b8', fontSize: 13, flexShrink: 0 }}>
        {room.type === 'dm' ? '●' : '#'}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {room.name}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// RoomsErrorState (internal)
// ---------------------------------------------------------------------------

interface RoomsErrorStateProps {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

function RoomsErrorState({ message, onRetry, compact }: RoomsErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        padding: compact ? '12px 8px' : '24px 16px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <div style={{ fontSize: compact ? 12 : 14, fontWeight: 600, color: '#b91c1c' }}>
        Couldn't load rooms
      </div>
      <div style={{ fontSize: compact ? 11 : 12, color: '#64748b' }}>{message}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 4,
            padding: compact ? '3px 10px' : '4px 14px',
            fontSize: compact ? 11 : 12,
            fontWeight: 500,
            color: '#1d4ed8',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoomList (exported)
// ---------------------------------------------------------------------------

export function RoomList({ idToken, rooms, createRoom, createDM, loading, error, onRetry, onRoomSelect, activeRoomId, compact }: RoomListProps) {
  const { friends } = useFriends({ idToken });

  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreateRoom = async (name: string) => {
    await createRoom(name);
    setShowCreateForm(false);
  };

  if (compact) {
    return (
      <div style={{ padding: '8px 8px 0' }}>
        {/* Compact "+ New Room" link */}
        <button
          onClick={() => setShowCreateForm(prev => !prev)}
          style={{
            width: '100%', textAlign: 'left', padding: '5px 8px',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#646cff', fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            borderRadius: 4,
          }}
        >
          + New Room
        </button>
        {showCreateForm && (
          <CreateRoomForm
            onCreate={handleCreateRoom}
            onDiscard={() => setShowCreateForm(false)}
            loading={loading}
          />
        )}
        <DMRoomButton onCreateDM={createDM} loading={loading} friends={friends} />
        <div>
          {loading && rooms.length === 0 ? (
            <div style={{ padding: '8px', color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>Loading…</div>
          ) : error && rooms.length === 0 ? (
            <RoomsErrorState message={error} onRetry={onRetry} compact />
          ) : rooms.length === 0 ? (
            <div style={{ padding: '12px 8px', color: '#94a3b8', fontSize: 12 }}>No rooms yet</div>
          ) : (
            rooms.map(room => (
              <CompactRoomRow
                key={room.roomId}
                room={room}
                isActive={room.roomId === activeRoomId}
                onClick={() => onRoomSelect(room)}
              />
            ))
          )}
        </div>
      </div>
    );
  }

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
      <h2 style={sectionHeaderStyle}>Rooms</h2>
      <button
        onClick={() => setShowCreateForm(prev => !prev)}
        style={{
          width: '100%',
          height: 36,
          marginBottom: 8,
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
        Create Room
      </button>
      {showCreateForm && (
        <CreateRoomForm
          onCreate={handleCreateRoom}
          onDiscard={() => setShowCreateForm(false)}
          loading={loading}
        />
      )}
      <DMRoomButton onCreateDM={createDM} loading={loading} friends={friends} />
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {loading && rooms.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1rem', justifyContent: 'center', color: '#64748b' }}>
            <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #e2e8f0', borderTopColor: '#646cff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Loading...
          </div>
        ) : error && rooms.length === 0 ? (
          <RoomsErrorState message={error} onRetry={onRetry} />
        ) : rooms.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              No rooms yet
            </div>
            <div style={{ fontSize: 14, color: '#9ca3af' }}>
              Create a room or ask to be added.
            </div>
          </div>
        ) : (
          rooms.map(room => (
            <RoomRow
              key={room.roomId}
              room={room}
              isActive={room.roomId === activeRoomId}
              onClick={() => onRoomSelect(room)}
            />
          ))
        )}
      </div>
    </div>
  );
}
