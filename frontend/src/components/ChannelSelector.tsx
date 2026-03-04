// frontend/src/components/ChannelSelector.tsx
import { useState } from 'react';

interface Props {
  currentChannel: string;
  onSwitch: (channel: string) => void;
}

export function ChannelSelector({ currentChannel, onSwitch }: Props) {
  const [input, setInput] = useState(currentChannel);

  const handleSwitch = () => {
    const trimmed = input.trim();
    if (trimmed && trimmed !== currentChannel) {
      onSwitch(trimmed);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'monospace' }}>
      <label style={{ color: '#6b7280' }}>Channel:</label>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSwitch()}
        style={{
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          padding: '0.25rem 0.5rem',
          fontFamily: 'monospace',
        }}
      />
      <button
        onClick={handleSwitch}
        style={{
          background: '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          padding: '0.25rem 0.75rem',
          cursor: 'pointer',
          fontFamily: 'monospace',
        }}
      >
        Switch
      </button>
      <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
        (current: {currentChannel})
      </span>
    </div>
  );
}
