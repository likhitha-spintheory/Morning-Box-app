import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
/* Each build gets an id; dist/version.json lets an open app notice a newer build and offer a refresh. */
const build = Date.now().toString(36);

export default defineConfig({
  plugins: [react(), { name: 'build-id', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, build }) }); } }],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(build) },
  server: { proxy: { '/api': 'http://localhost:8787' } },
  preview: { proxy: { '/api': 'http://localhost:8787' } }
});
