// frontend/src/components/shared/SkeletonCard.tsx
//
// Shimmer placeholder used while content loads. A background gradient slides
// across the card via a keyframe animation injected into a <style> tag.

export interface SkeletonCardProps {
  width?: number | string;
  height?: number | string;
}

const ANIMATION_CSS = `
@keyframes ws-skeleton-shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: 200px 0; }
}
`;

function SkeletonCard({ width = '100%', height = 64 }: SkeletonCardProps) {
  return (
    <>
      <style>{ANIMATION_CSS}</style>
      <div
        data-testid="skeleton-card"
        style={{
          width,
          height,
          borderRadius: 8,
          background: 'linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%)',
          backgroundSize: '400px 100%',
          animation: 'ws-skeleton-shimmer 1.4s ease-in-out infinite',
        }}
      />
    </>
  );
}

export default SkeletonCard;
