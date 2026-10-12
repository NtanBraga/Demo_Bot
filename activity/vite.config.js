import { defineConfig } from "vite"

export default defineConfig({
    server: {
        allowedHosts: [
            "offering-supervision-latinas-institute.trycloudflare.com"
        ]
    }
})