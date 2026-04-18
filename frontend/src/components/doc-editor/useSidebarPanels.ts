import { useCallback, useState } from 'react';

// Top-level sidebar panels are mutually exclusive — only one can be open at a
// time. Video call is intentionally NOT part of this state machine because it
// has docking semantics (stays visible in the global sidebar while another
// panel is active).
export type SidebarPanel = 'history' | 'myItems' | 'workflows' | 'videoHistory';

interface UseSidebarPanelsOptions {
  initialPanel?: SidebarPanel | null;
}

export interface UseSidebarPanelsReturn {
  activePanel: SidebarPanel | null;
  showHistory: boolean;
  showMyItems: boolean;
  showWorkflows: boolean;
  showVideoHistory: boolean;
  toggleHistory: () => void;
  toggleMyItems: () => void;
  toggleWorkflows: () => void;
  toggleVideoHistory: () => void;
  openPanel: (panel: SidebarPanel) => void;
  closePanel: () => void;
}

export function useSidebarPanels(
  options: UseSidebarPanelsOptions = {},
): UseSidebarPanelsReturn {
  const [activePanel, setActivePanel] = useState<SidebarPanel | null>(
    options.initialPanel ?? null,
  );

  const toggle = useCallback((panel: SidebarPanel) => {
    setActivePanel(current => (current === panel ? null : panel));
  }, []);

  const openPanel = useCallback((panel: SidebarPanel) => {
    setActivePanel(panel);
  }, []);

  const closePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  return {
    activePanel,
    showHistory: activePanel === 'history',
    showMyItems: activePanel === 'myItems',
    showWorkflows: activePanel === 'workflows',
    showVideoHistory: activePanel === 'videoHistory',
    toggleHistory: useCallback(() => toggle('history'), [toggle]),
    toggleMyItems: useCallback(() => toggle('myItems'), [toggle]),
    toggleWorkflows: useCallback(() => toggle('workflows'), [toggle]),
    toggleVideoHistory: useCallback(() => toggle('videoHistory'), [toggle]),
    openPanel,
    closePanel,
  };
}
