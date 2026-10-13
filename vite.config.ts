import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vlyPlugin(), react(), tailwindcss()],
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": "/src",
    },
    // Keep a single React copy across the app.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  },
  build: {
    // Enable source maps for better debugging (disable in production if needed)
    sourcemap: false,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and lazy loading
        manualChunks: {
          // Vendor chunks for large libraries
          'react-vendor': ['react', 'react-dom', 'react-router'],
          // Heavy optional libraries - separate chunks for better lazy loading
          'framer-motion': ['framer-motion'],
          'three': ['three'],
        },
        // Optimize chunk size
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit for better chunking
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for better optimization
    target: 'esnext',
    // Minify options - using esbuild (faster than terser)
    minify: 'esbuild',
  },
  // Optimize dependencies
  optimizeDeps: {
    entries: ["index.html"],
    include: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "react-router", "framer-motion", "three"],
  },
  // Performance hints
  server: {
    // Bind to all interfaces so WebContainer's server-ready event fires.
    host: true,
    port: 5173,
    // Keep HMR on, but disable the full-screen error overlay
    hmr: {
      overlay: false,
    },
  },
});
