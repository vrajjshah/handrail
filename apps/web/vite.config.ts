import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fixed, because the dogfood scan (#24) points at this URL and a scanned
    // URL is hashed into every finding id — a port that moves churns the whole
    // snapshot. The engine's golden scan learned this the hard way.
    port: 5180,
    strictPort: true,
  },
  preview: { port: 5180, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
