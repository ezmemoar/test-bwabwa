import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // One server, one database: files run one after another so state stays predictable.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
})
