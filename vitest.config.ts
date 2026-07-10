import { defineConfig } from 'vitest/config'

// Unit tests run in a plain Node environment (jsdom is intentionally not a
// dependency). Main-process modules import only types from './settings', so
// they never pull in the 'electron' runtime and need no mocking. Renderer tests
// stay DOM-free: the Markdown renderer is exercised by walking the returned
// React element tree, which the automatic JSX runtime builds as plain objects.
export default defineConfig({
  esbuild: {
    jsx: 'automatic'
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false
  }
})
