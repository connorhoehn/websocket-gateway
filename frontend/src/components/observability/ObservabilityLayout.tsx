import { Outlet } from 'react-router';

// Note: ObservabilityProvider is hoisted to AppLayoutInner so the cluster
// dashboard is available app-wide (alert toasts, sub-nav badges, etc.). This
// layout is now a thin pass-through that just renders the nested observability
// routes.
export default function ObservabilityLayout() {
  return <Outlet />;
}
