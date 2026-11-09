import { defineConfig } from 'vite';

// Relative base so the build works from https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
