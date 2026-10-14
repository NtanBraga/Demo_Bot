import { model } from "mongoose"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({mode}) => {
    const env = loadEnv(model, process.cwd(), "")

    return{
        server: {
            strictPort: true,
            allowedHosts: [
                env.CLOUDFLARE_TUNNEL
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
    }
    
})

/* Get-ChildItem Env:DEMO_MSE* */
/* $env:DEMO_MSE_PUBLISH_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    $env:DEMO_MSE_VIEW_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" */