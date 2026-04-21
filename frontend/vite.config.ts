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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-yjs': ['yjs'],
          'vendor-tiptap': ['@tiptap/core', '@tiptap/react', '@tiptap/starter-kit'],
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
