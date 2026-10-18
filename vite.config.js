import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work on both a GitHub project subpath and a domain root.
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@dimforge')) return 'physics';
          if (id.includes('/three/')) return 'three';
        },
      },
    },
  },
});
