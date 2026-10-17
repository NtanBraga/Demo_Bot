'use strict'

const MAX_BODY_BYTES = 4096

function responderJSON(res, status, data){
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    })
    res.end(JSON.stringify(data))
}

async function tratarTokenDiscord(req, res){
    if(req.method !== 'POST'){
        res.setHeader('Allow', 'POST')

        return responderJSON(res, 405, {
            error: 'method_not_allowed'
        })
    }
    if(!req.headers['content-type']?.toLowerCase().startsWith('application/json')){
        return responderJSON(res, 415, {
            error: 'content_type_must_be_json'
        })
    }

    const clientId = process.env.DISCORD_CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET

    if(!clientId || !clientSecret){
        return responderJSON(res, 503, {
            error: 'oauth_not_configured'
        })
    }

    try{
        const chunks = []
        let bytes = 0

        for await (const chunk of req){
            bytes += chunk.length

            if(bytes > MAX_BODY_BYTES){
                return responderJSON(res, 413, {
                    error: 'body_too_large'
                })
            }
            chunks.push(chunk)
        }
        let payload

        try{
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }catch{
            return responderJSON(res, 400, {
                error: 'invalid_json'
            })
        }

        const code = payload?.code

        if(typeof code !== 'string' || !code || code.length > 2048){
            return responderJSON(res, 400, {
                error: 'invalid_code'
            })
        }

        const response = await fetch('https://discord.com/api/v10/oauth2/token',
            {
                method: 'POST',
                headers: { 'Content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'authorization_code',
                    code
                }),
                signal: AbortSignal.timeout(10_000)
            }
        )
        if(!response.ok){
            console.warn(`[Discord OAuth] Troca recusada: HTTP ${response.status}`)

            return responderJSON(res, 502, {
                error: 'discord_token_exchange_failed'
            })
        }
        const result = await response.json()

        if(typeof result.access_token !== 'string' || !result.access_token){
            return responderJSON(res, 502, {
                error: 'discord_token_missing'
            })
        }

        return responderJSON(res, 200, {
            access_token: result.access_token
        })
    }catch(e){
        console.error('[Discord OAuth] Falha na troca de codigo: ', e.name)

        return responderJSON(res, 502, {
            error: 'discord_token_request_failed'
        })
    }
}

module.exports = { tratarTokenDiscord }