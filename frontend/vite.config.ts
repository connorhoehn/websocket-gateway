import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_'],
  resolve: {
    alias: {
      // Ensure collaboration-cursor's y-prosemirror imports resolve to the
      // same package that @tiptap/extension-collaboration uses internally.
      'y-prosemirror': '@tiptap/y-tiptap',
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
