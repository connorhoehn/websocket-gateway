// CookbooksModal tests — verify card rendering, filtering, and selection.

import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CookbooksModal } from '../CookbooksModal';

describe('CookbooksModal', () => {
  test('renders modal with title', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<CookbooksModal onClose={onClose} onSelect={onSelect} />);

    expect(screen.getByText('Install Cookbook')).toBeInTheDocument();
  });

  test('renders category buttons', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<CookbooksModal onClose={onClose} onSelect={onSelect} />);

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  test('renders cookbook cards', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<CookbooksModal onClose={onClose} onSelect={onSelect} />);

    // Check for known cookbooks
    expect(screen.getByText('Bug Report')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
  });

  test('calls onSelect when Install button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<CookbooksModal onClose={onClose} onSelect={onSelect} />);

    const installButtons = screen.getAllByText('Install');
    await user.click(installButtons[0]);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.any(String),
      fields: expect.any(Array),
    }));
  });
});
