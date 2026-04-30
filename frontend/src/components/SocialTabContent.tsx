// frontend/src/components/SocialTabContent.tsx
//
// Slack-style layout: compact room/DM sidebar on the left, chat view on the right.

import { useState } from 'react';
import type { RoomItem } from '../hooks/useRooms';
import type { ActivityEvent } from '../hooks/useActivityBus';
import type { GatewayMessage } from '../types/gateway';

import { RoomList } from './RoomList';
import { GroupPanel } from './GroupPanel';
import { ChatRoom } from './ChatRoom';

type OnMessageFn = (handler: (msg: GatewayMessage) => void) => () => void;

export interface SocialTabContentProps {
  userId: string;
  displayName: string;
  userEmail: string;
  connectionState: string;
  idToken: string | null;
  rooms: RoomItem[];
  createRoom: (name: string) => Promise<void>;
  createDM: (targetUserId: string) => Promise<void>;
  createGroupRoom: (groupId: string, name: string) => Promise<void>;
  roomsLoading: boolean;
  roomsError?: string | null;
  onRoomsRetry?: () => void;
  handleRoomSelect: (room: RoomItem) => void;
  activeRoomId: string | null;
  activityEvents: ActivityEvent[];
  onMessage: OnMessageFn;
}

export default function SocialTabContent({
  userId,
  displayName,
  idToken,
  rooms,
  createRoom,
  createDM,
  createGroupRoom,
  roomsLoading,
  roomsError,
  onRoomsRetry,
  handleRoomSelect,
  activeRoomId,
  onMessage,
}: SocialTabContentProps) {
  const [socialTab, setSocialTab] = useState<'channels' | 'groups' | 'dms'>('channels');

  const initials = displayName
    ? displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : userId.slice(0, 2).toUpperCase();

  const activeRoom = rooms.find(r => r.roomId === activeRoomId) ?? null;

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 120px)',
      background: '#fff',
      borderRadius: 8,
      border: '1px solid #e2e8f0',
      overflow: 'hidden',
    }}>
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div style={{
        width: 240, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        borderRight: '1px solid #e2e8f0',
        background: '#f8fafc',
        overflow: 'hidden',
      }}>
        {/* Profile row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 14px',
          borderBottom: '1px solid #e2e8f0',
          flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, #646cff, #9b59b6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0,
          }}>
            {initials}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName || userId}
          </span>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          {([['channels', 'Channels'], ['groups', 'Groups'], ['dms', 'DMs']] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => setSocialTab(tab)} style={{
              flex: 1, padding: '7px 0', border: 'none', background: 'none',
              borderBottom: socialTab === tab ? '2px solid #646cff' : '2px solid transparent',
              color: socialTab === tab ? '#0f172a' : '#64748b',
              fontWeight: socialTab === tab ? 600 : 400,
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Room list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {socialTab === 'channels' && (
            <RoomList
              idToken={idToken}
              rooms={rooms.filter(r => r.type !== 'dm')}
              createRoom={createRoom}
              createDM={createDM}
              loading={roomsLoading}
              error={roomsError}
              onRetry={onRoomsRetry}
              onRoomSelect={handleRoomSelect}
              activeRoomId={activeRoomId}
              compact
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
            <RoomList
              idToken={idToken}
              rooms={rooms.filter(r => r.type === 'dm')}
              createRoom={createRoom}
              createDM={createDM}
              loading={roomsLoading}
              error={roomsError}
              onRetry={onRoomsRetry}
              onRoomSelect={handleRoomSelect}
              activeRoomId={activeRoomId}
              compact
            />
          )}
        </div>
      </div>

      {/* ── Main chat area ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {activeRoom ? (
          <ChatRoom
            key={activeRoom.roomId}
            idToken={idToken}
            roomId={activeRoom.roomId}
            roomName={activeRoom.name}
            onMessage={onMessage}
          />
        ) : (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: '#94a3b8', gap: 8,
          }}>
            <span style={{ fontSize: 36 }}>💬</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Select a room to start chatting</span>
            <span style={{ fontSize: 13 }}>Choose a channel or DM from the sidebar</span>
          </div>
        )}
      </div>
    </div>
  );
}
