import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // The HiGHS wasm binary must stay a real file so locateFile can point at it.
    assetsInlineLimit: 0,
  },
})
