import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()], // koffi must load from node_modules, never be bundled
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Sandboxed preload scripts cannot be ESM — emit a classic CJS script.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    },
    resolve: { alias: shared }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: shared }
  }
})
