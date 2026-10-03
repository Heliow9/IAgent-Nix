import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})
