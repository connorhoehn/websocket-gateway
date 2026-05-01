// frontend/src/components/doc-types/CookbooksModal.tsx
//
// Gallery of prebuilt document type templates ("cookbooks"). Pick one and the
// modal will call createType() to persist it, then invoke onCreated(typeId)
// so the caller can open the wizard for customization.
//
// Modeled after the pipeline TemplatesModal (src/components/pipelines/TemplatesModal.tsx).

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../shared/Modal';
import { colors, fieldStyle } from '../../constants/styles';
import {
  documentTypeCookbooks,
  COOKBOOK_CATEGORIES,
  type CookbookCategory,
  type DocumentTypeCookbook,
} from './cookbooks';
import type { DocumentType } from '../../types/documentType';

interface CookbooksModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (typeId: string) => void;
  createType: (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => DocumentType;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface CookbookCardProps {
  cookbook: DocumentTypeCookbook;
  onPick: (c: DocumentTypeCookbook) => void;
}

function CookbookCard({ cookbook, onPick }: CookbookCardProps) {
  return (
    <div
      data-testid={`cookbook-card-${cookbook.id}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        width: 220, minHeight: 200, padding: 14,
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }} aria-hidden>{cookbook.icon}</span>
        <div
          style={{
            fontSize: 14, fontWeight: 700, color: colors.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {cookbook.name}
        </div>
      </div>
      <div
        style={{ fontSize: 11, color: colors.textTertiary, display: 'flex', gap: 8 }}
      >
        <span>{cookbook.category}</span>
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.4, flex: 1 }}>
        {cookbook.description}
      </div>
      {cookbook.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {cookbook.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: colors.surfaceHover, color: colors.textSecondary,
                textTransform: 'lowercase',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        data-testid={`cookbook-use-${cookbook.id}`}
        onClick={() => onPick(cookbook)}
        style={{
          marginTop: 'auto',
          padding: '6px 10px', fontSize: 12, fontWeight: 600,
          background: colors.primary, color: '#fff', border: 'none',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Install
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export default function CookbooksModal({
  open, onClose, onCreated, createType,
}: CookbooksModalProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<CookbookCategory | 'All'>('All');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch('');
      setActiveCategory('All');
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    let results = documentTypeCookbooks;
    if (activeCategory !== 'All') {
      results = results.filter((c) => c.category === activeCategory);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      results = results.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        c.category.toLowerCase().includes(q),
      );
    }
    return results;
  }, [search, activeCategory]);

  const handlePick = (cookbook: DocumentTypeCookbook) => {
    const data = cookbook.build();
    const created = createType(data);
    onClose();
    onCreated(created.id);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      handlePick(filtered[0]);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Document type cookbooks"
      maxWidth={800}
      backdropTestId="cookbooks-modal"
      rawChildren
    >
      <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
        Install a prebuilt document type. You can customize the fields after installing.
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          data-testid="cookbook-cat-all"
          onClick={() => setActiveCategory('All')}
          style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 12,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            background: activeCategory === 'All' ? colors.primary : colors.surfaceHover,
            color: activeCategory === 'All' ? '#fff' : colors.textSecondary,
          }}
        >
          All
        </button>
        {COOKBOOK_CATEGORIES.map((cat) => (
          <button
            type="button"
            key={cat}
            data-testid={`cookbook-cat-${cat.toLowerCase().replace(/[^a-z]/g, '-')}`}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 12,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: activeCategory === cat ? colors.primary : colors.surfaceHover,
              color: activeCategory === cat ? '#fff' : colors.textSecondary,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <input
        ref={searchRef}
        type="search"
        data-testid="cookbooks-search"
        placeholder="Search cookbooks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        style={{ ...fieldStyle, width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}
      />

      {filtered.length === 0 ? (
        <div
          data-testid="cookbooks-empty"
          style={{ textAlign: 'center', padding: 32, fontSize: 13, color: colors.textTertiary }}
        >
          No cookbooks match "{search}".
        </div>
      ) : (
        <div
          data-testid="cookbooks-grid"
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 220px)',
            gap: 12, justifyContent: 'center',
            maxHeight: '60vh', overflowY: 'auto', padding: 4,
          }}
        >
          {filtered.map((cookbook) => (
            <CookbookCard
              key={cookbook.id}
              cookbook={cookbook}
              onPick={handlePick}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
