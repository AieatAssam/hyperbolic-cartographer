import { defineConfig } from 'vite';

export default defineConfig({
  base: '/hyperbolic-cartographer/',
  test: { include: ['tests/**/*.test.ts'] },
} as never);
