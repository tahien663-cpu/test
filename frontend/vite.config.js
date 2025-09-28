import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['smooth-masks-fix.loca.lt'], // 👈 Add this line
    proxy: {
      '/api': {
        target: 'http://localhost:3001', // Ensure this matches your backend port
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
