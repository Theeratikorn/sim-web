import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        courses: resolve(__dirname, 'courses.html'),
        lesson: resolve(__dirname, 'lesson.html'),
        sim: resolve(__dirname, 'sim.html')
      }
    }
  }
})
