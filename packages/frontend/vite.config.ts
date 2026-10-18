import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Names the current build of the panel: `assets/panel-build.json` holds the
 * panel entry's file name, which changes with every build. The loader HA
 * loads (public/assets/panel-wrapper.js, which never changes) asks for it
 * through Circuitry's API at each panel load, so a new build is used without
 * restarting Home Assistant (whose service worker serves files from its
 * cache first).
 */
function panelBuildFile(): Plugin {
  return {
    name: 'circuitry-panel-build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (file) => file.type === 'chunk' && file.isEntry && file.name === 'panel-app'
      );
      if (!entry) throw new Error('circuitry-panel-build: no panel-app entry in the build');
      this.emitFile({
        type: 'asset',
        fileName: 'assets/panel-build.json',
        source: `${JSON.stringify({ entry: entry.fileName.replace(/^assets\//, '') })}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), panelBuildFile()],
  base: '/circuitry-hass/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The large chunks (transpiler+elkjs, code editor) are lazily loaded on
    // demand, not part of the initial payload — so the default 500 kB warning
    // is just noise here.
    chunkSizeWarningLimit: 1700,
    // The step icons (src/assets/emoji) stay files, loaded as they're shown,
    // instead of being inlined into the scripts as data URLs.
    assetsInlineLimit: (file) => (file.includes('/assets/emoji/') ? false : undefined),
    rollupOptions: {
      input: {
        // Standalone dev preview only (`yarn dev` / index.html) — the real HA
        // panel is mounted by panel-wrapper.ts, not this entry.
        main: path.resolve(__dirname, 'index.html'),
        // The panel itself (mounts into a Shadow DOM instead of an iframe,
        // see panel-wrapper.ts for the rationale). Its name changes with each
        // build; HA loads public/assets/panel-wrapper.js, which loads it.
        'panel-app': path.resolve(__dirname, 'src/panel-wrapper.ts'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        // Split heavy vendor libs into separate, long-term cacheable chunks
        // so the main bundle stays small and updates don't re-download vendors.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@xyflow') || id.includes('d3-')) return 'vendor-reactflow';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          // Everything else: let Rolldown decide. Deps used only by a lazy
          // route stay in that lazy chunk instead of bloating a shared vendor.
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5174,
    open: true,
  },
});
