import { defineConfig } from "vite"

export default defineConfig({
    server: {
        strictPort: true,
        allowedHosts: [
            "surf-informed-streets-spent.trycloudflare.com"
        ],
        proxy: {
            "/ws-mse": {
                target: "ws://127.0.0.1:3002",
                ws: true,
                changeOrigin: false
            },
            "/ws": {
                target: "ws://127.0.0.1:3001",
                ws: true,
                changeOrigin: false
            }
        }
    }
})