// CookbooksModal tests — verify card rendering, filtering, and selection.

import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CookbooksModal from '../CookbooksModal';
import type { DocumentType } from '../../../types/documentType';

describe('CookbooksModal', () => {
  const mockCreateType = (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>): DocumentType => ({
    ...data,
    id: 'mock-id-' + Math.random(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  test('renders modal with title', () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<CookbooksModal open={true} onClose={onClose} onCreated={onCreated} createType={mockCreateType} />);

    expect(screen.getByText('Document type cookbooks')).toBeInTheDocument();
  });

  test('renders category buttons', () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<CookbooksModal open={true} onClose={onClose} onCreated={onCreated} createType={mockCreateType} />);

    expect(screen.getByTestId('cookbook-cat-all')).toBeInTheDocument();
    expect(screen.getByTestId('cookbook-cat-engineering')).toBeInTheDocument();
    expect(screen.getByTestId('cookbook-cat-general')).toBeInTheDocument();
  });

  test('renders cookbook cards', () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<CookbooksModal open={true} onClose={onClose} onCreated={onCreated} createType={mockCreateType} />);

    // Check for known cookbooks
    expect(screen.getByText('Bug Report')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
  });

  test('calls onCreated when Install button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const createType = vi.fn(mockCreateType);
    render(<CookbooksModal open={true} onClose={onClose} onCreated={onCreated} createType={createType} />);

    const installButtons = screen.getAllByText('Install');
    await user.click(installButtons[0]);

    expect(createType).toHaveBeenCalledTimes(1);
    expect(createType).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.any(String),
      fields: expect.any(Array),
    }));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(expect.any(String));
  });
});
