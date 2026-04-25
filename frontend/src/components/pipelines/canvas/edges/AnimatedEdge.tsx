// frontend/src/components/pipelines/canvas/edges/AnimatedEdge.tsx
//
// Custom React Flow edge supporting four visual states (default / active /
// traversed-success / traversed-failure) per PIPELINES_PLAN.md §7.2, and an
// optional branch label pill rendered near the source end (true/false/
// approved/rejected/branch-N/error).
//
// Stroke + animation is applied as a plain <path>; the dashoffset SMIL
// animation is what gives 'active' the flow effect.
import { EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { usePrefersReducedMotion } from '../../../../hooks/usePrefersReducedMotion';

export type EdgeState =
  | 'default'
  | 'active'
  | 'traversed-success'
  | 'traversed-failure';

export interface AnimatedEdgeData {
  state?: EdgeState;
  label?: string;
}

interface StrokeSpec {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  animate?: boolean;
}

function strokeFor(state: EdgeState | undefined): StrokeSpec {
  switch (state) {
    case 'active':
      return {
        stroke: '#2563eb',
        strokeWidth: 2,
        strokeDasharray: '6 4',
        animate: true,
      };
    case 'traversed-success':
      return { stroke: '#16a34a', strokeWidth: 2 };
    case 'traversed-failure':
      return { stroke: '#dc2626', strokeWidth: 2 };
    case 'default':
    default:
      return { stroke: '#cbd5e1', strokeWidth: 1.5 };
  }
}

export default function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeData = (data ?? {}) as AnimatedEdgeData;
  const reduceMotion = usePrefersReducedMotion();
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const spec = strokeFor(edgeData.state);
  // §18.12 reduced-motion: keep the active-edge color but drop the SMIL
  // sweep so the path reads as a solid colored line instead of flowing
  // dashes. The stroke width stays at 2 to preserve the visual weight
  // difference between `default` and `active`.
  const animateFlow = spec.animate && !reduceMotion;

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={spec.stroke}
        strokeWidth={spec.strokeWidth}
        strokeDasharray={animateFlow ? spec.strokeDasharray : undefined}
        markerEnd={markerEnd}
        style={{ pointerEvents: 'stroke' }}
      >
        {animateFlow ? (
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-20"
            dur="1s"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      {edgeData.label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              // Pull the pill slightly downstream of the source handle so it
              // sits inside the edge route rather than on top of the node.
              transform: `translate(-50%, -50%) translate(${sourceX + 28}px, ${sourceY}px)`,
              pointerEvents: 'all',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1.4,
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #e2e8f0',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
            }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
