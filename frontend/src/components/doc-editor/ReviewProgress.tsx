// frontend/src/components/doc-editor/ReviewProgress.tsx
//
// Simple progress bar showing section review progress.

interface ReviewProgressProps {
  current: number;
  total: number;
}

const containerStyle: React.CSSProperties = {
  marginBottom: '1rem',
};

const barBackground: React.CSSProperties = {
  height: 8,
  background: '#e5e7eb',
  borderRadius: 4,
  overflow: 'hidden',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#6b7280',
  marginBottom: 4,
  display: 'flex',
  justifyContent: 'space-between',
};

export default function ReviewProgress({ current, total }: ReviewProgressProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div style={containerStyle}>
      <div style={labelStyle}>
        <span>{current} of {total} sections reviewed</span>
        <span>{pct}%</span>
      </div>
      <div style={barBackground}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: '#3b82f6',
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
