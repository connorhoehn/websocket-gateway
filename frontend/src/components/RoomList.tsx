// frontend/src/components/RoomList.tsx
//
// Room list section card — all sub-components co-located as unexported internals.
// Only RoomList is exported. Forwards onMessage to useRooms for RTIM-04.

import { useState } from 'react';
import { useRooms } from '../hooks/useRooms';
import type { RoomItem } from '../hooks/useRooms';
import type { GatewayMessage } from '../types/gateway';
import { useFriends } from '../hooks/useFriends';
import type { PublicProfile } from '../hooks/useFriends';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

interface RoomListProps {
  idToken: string | null;
  onMessage: OnMessageFn;
  onRoomSelect: (room: RoomItem) => void;
  activeRoomId?: string | null;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void onCreate(name.trim());
    setName('');
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 8, padding: '12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerId.trim()) return;
    void onCreateDM(peerId.trim());
    setPeerId('');
    setShowForm(false);
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
    <form onSubmit={handleSubmit} style={{ marginBottom: 12, padding: '12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
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
// RoomList (exported)
// ---------------------------------------------------------------------------

export function RoomList({ idToken, onMessage, onRoomSelect, activeRoomId }: RoomListProps) {
  const {
    rooms,
    createRoom,
    createDM,
    loading,
  } = useRooms({ idToken, onMessage });

  const { friends } = useFriends({ idToken });

  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreateRoom = async (name: string) => {
    await createRoom(name);
    setShowCreateForm(false);
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
        {rooms.length === 0 ? (
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
