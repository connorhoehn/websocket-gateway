// frontend/src/components/doc-editor/TaskList.tsx
//
// Renders a list of task items within a section.

import type { TaskItem } from '../../types/document';
import TaskItemRow from './TaskItemRow';

export interface TaskListProps {
  items: TaskItem[];
  editable: boolean;
  onUpdateItem: (itemId: string, patch: Partial<TaskItem>) => void;
  onRemoveItem: (itemId: string) => void;
}

const listStyle: React.CSSProperties = {
  padding: '8px 0',
};

const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 13,
  fontStyle: 'italic',
  padding: '8px 0',
};

export default function TaskList({ items, editable, onUpdateItem, onRemoveItem }: TaskListProps) {
  if (items.length === 0) {
    return <div style={emptyStyle}>No tasks yet.</div>;
  }

  return (
    <div style={listStyle}>
      {items.map((item) => (
        <TaskItemRow
          key={item.id}
          item={item}
          editable={editable}
          onUpdate={(patch) => onUpdateItem(item.id, patch)}
          onRemove={() => onRemoveItem(item.id)}
        />
      ))}
    </div>
  );
}
