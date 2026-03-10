// frontend/src/components/SharedTextEditor.tsx
//
// Controlled textarea component bound to useCRDT content and applyLocalEdit.
// Receives all data as props — no internal hook calls.

export interface SharedTextEditorProps {
  content: string;
  applyLocalEdit: (newText: string) => void;
  disabled?: boolean; // true when not connected — prevents sending updates to a closed socket
}

export function SharedTextEditor({ content, applyLocalEdit, disabled = false }: SharedTextEditorProps) {
  return (
    <div>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Shared Document</h3>
      <textarea
        value={content}
        onChange={(e) => applyLocalEdit(e.target.value)}
        readOnly={disabled}
        style={{
          width: '100%',
          minHeight: '200px',
          fontFamily: 'monospace',
          fontSize: '0.875rem',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          padding: '0.5rem',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      {disabled && (
        <p style={{ color: '#9ca3af', margin: '0.25rem 0 0' }}>
          (disconnected — reconnect to edit)
        </p>
      )}
    </div>
  );
}
