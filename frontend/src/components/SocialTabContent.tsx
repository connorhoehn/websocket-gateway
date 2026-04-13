// frontend/src/components/SocialTabContent.tsx
//
// Lazy-loadable view for the "Social" tab — profile card + channels/groups/DMs + activity.

import { useState } from 'react';
import type { GatewayMessage } from '../types/gateway';
import type { RoomItem } from '../hooks/useRooms';
import type { ActivityEvent } from '../hooks/useActivityBus';

import { RoomList } from './RoomList';
import { GroupPanel } from './GroupPanel';

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

export interface SocialTabContentProps {
  userId: string;
  displayName: string;
  userEmail: string;
  connectionState: string;
  idToken: string | null;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  rooms: RoomItem[];
  createRoom: (name: string) => Promise<void>;
  createDM: (targetUserId: string) => Promise<void>;
  createGroupRoom: (groupId: string, name: string) => Promise<void>;
  roomsLoading: boolean;
  handleRoomSelect: (room: RoomItem) => void;
  activeRoomId: string | null;
  activityEvents: ActivityEvent[];
}

export default function SocialTabContent({
  userId,
  displayName,
  userEmail,
  connectionState,
  idToken,
  rooms,
  createRoom,
  createDM,
  createGroupRoom,
  roomsLoading,
  handleRoomSelect,
  activeRoomId,
  activityEvents,
}: SocialTabContentProps) {
  const [socialTab, setSocialTab] = useState<'groups' | 'channels' | 'dms'>('channels');

  const initials = displayName
    ? displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : userId.slice(0, 2).toUpperCase();

  return (
    <>
      {/* Profile card */}
      <div style={{
        ...sectionCardStyle,
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'linear-gradient(135deg, #646cff, #9b59b6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: '1rem', flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '1rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName || userId}
          </div>
          {userEmail && (
            <div style={{ fontSize: '0.8125rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userEmail}
            </div>
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          fontSize: '0.75rem', fontWeight: 500,
          color: connectionState === 'connected' ? '#16a34a' : '#ef4444', flexShrink: 0,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connectionState === 'connected' ? '#16a34a' : '#ef4444',
            display: 'inline-block',
          }} />
          {connectionState === 'connected' ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Split layout: left tabs + right activity */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        {/* Left panel — Groups / Channels / DMs */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Sub-tabs */}
          <div style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid #e2e8f0', marginBottom: '0.75rem',
          }}>
            {([
              ['channels', 'Channels'],
              ['groups', 'Groups'],
              ['dms', 'DMs'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setSocialTab(tab)}
                style={{
                  padding: '0.5rem 1rem', border: 'none',
                  borderBottom: socialTab === tab ? '2px solid #646cff' : '2px solid transparent',
                  background: 'none',
                  color: socialTab === tab ? '#0f172a' : '#64748b',
                  fontWeight: socialTab === tab ? 600 : 400,
                  fontSize: '0.875rem', cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {socialTab === 'channels' && (
            <RoomList
              idToken={idToken}
              rooms={rooms}
              createRoom={createRoom}
              createDM={createDM}
              loading={roomsLoading}
              onRoomSelect={handleRoomSelect}
              activeRoomId={activeRoomId}
            />
          )}

          {socialTab === 'groups' && (
            <GroupPanel
              idToken={idToken}
              rooms={rooms}
              createGroupRoom={createGroupRoom}
              onRoomSelect={handleRoomSelect}
              roomsLoading={roomsLoading}
            />
          )}

          {socialTab === 'dms' && (
            <div style={sectionCardStyle}>
              <p style={sectionHeaderStyle}>Direct Messages</p>
              <RoomList
                idToken={idToken}
                rooms={rooms}
                createRoom={createRoom}
                createDM={createDM}
                loading={roomsLoading}
                onRoomSelect={handleRoomSelect}
                activeRoomId={activeRoomId}
              />
            </div>
          )}
        </div>

        {/* Right panel — Activity (always visible) */}
        <div style={{
          width: 320, flexShrink: 0,
          ...sectionCardStyle,
          position: 'sticky', top: '1rem',
          maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
        }}>
          <p style={sectionHeaderStyle}>Activity</p>
          {activityEvents.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>No activity yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {activityEvents.slice().reverse().slice(0, 50).map((evt) => (
                <div key={evt.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                  fontSize: '0.8125rem', padding: '0.375rem 0.5rem',
                  borderRadius: 6, background: '#f8fafc',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: evt.color || '#646cff', flexShrink: 0, marginTop: 6,
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      {evt.displayName || evt.userId || 'System'}
                    </span>
                    {' '}
                    <span style={{ color: '#64748b' }}>{evt.eventType}</span>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 1 }}>
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
