import { defineConfig, loadEnv } from "vite"
import { resolve } from 'node:path'

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
        },
        build: {
            rolldownOptions : {
                input: {
                    activity: resolve(process.cwd(), 'index.html'),
                    publisher: resolve(process.cwd(), 'transmitirWebRTC.html')
                }
            }
        }
    }
    
})