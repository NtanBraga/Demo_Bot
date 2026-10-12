import { defineConfig } from "vite"

export default defineConfig({
    server: {
        strictPort: true,
        allowedHosts: [
            "results-curriculum-earl-makeup.trycloudflare.com"
        ],
        proxy: {
            "/ws": {
                target: "ws://127.0.0.1:3001",
                ws: true,
                changeOrigin: false
            }
        }
    }
})