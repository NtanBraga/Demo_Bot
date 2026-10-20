import { defineConfig, loadEnv } from "vite"

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), "")

    return{
        server: {
            strictPort: true,
            allowedHosts: [
                env.HOST
            ],
            proxy: {
                "/ws-webrtc": {
                    target: "ws://127.0.0.1:3003",
                    ws: true,
                    changeOrigin: false
                },
                "/ws-sfu": {
                    target: "ws://127.0.0.1:3004",
                    ws: true,
                    changeOrigin: false
                },
                "/api/publisher": {
                    target: "http://127.0.0.1:3003",
                    changeOrigin: true
                },
                "/api/token": {
                    target: 'http://127.0.0.1:3003',
                    changeOrigin: true
                },
                "/api/identity": {
                    target: 'http://127.0.0.1:3003',
                    changeOrigin: true
                }
            }
        }
    }
    
})

/* Get-ChildItem Env:DEMO_MSE* */
/* $env:DEMO_MSE_PUBLISH_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    $env:DEMO_MSE_VIEW_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" */