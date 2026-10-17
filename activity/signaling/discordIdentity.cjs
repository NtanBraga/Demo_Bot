'use strict'

const crypto = require('node:crypto')

const TICKET_TTL_MS = 30_000
const MAX_PENDING_TICKETS = 500
const identityTickets = new Map()

function responderJSON(res, status, data){
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    })
    res.end(JSON.stringify(data))
}

function criarTicketIdentidade(user){
    if(identityTickets.size >= MAX_PENDING_TICKETS) return null

    const ticket = crypto.randomBytes(32).toString('base64url')

    identityTickets.set(ticket, {
        user,
        expiresAt: Date.now() + TICKET_TTL_MS
    })

    const timer = setTimeout(() => {
        identityTickets.delete(ticket)
    }, TICKET_TTL_MS)

    timer.unref()

    return ticket
}

function consumirTicketIdentidade(ticket){
    if(typeof ticket !== 'string') return null

    const entry = identityTickets.get(ticket)

    if(!entry) return null

    identityTickets.delete(ticket)

    if(Date.now() >= entry.expiresAt) return null

    return entry.user
}

async function tratarIdentidadeDiscord(req, res){
    if(req.method !== 'POST'){
        res.setHeader('Allow', 'POST')
    

        return responderJSON(res, 405, {
            error: 'method_not_allowed'
        })
    }

    const clientId = process.env.DISCORD_CLIENT_ID

    if(!clientId){
        return responderJSON(res, 503, {
            error: 'discord_client_not_configured'
        })
    }

    const authorization = req.headers.authorization

    const match = typeof authorization === 'string'
        ? /^Bearer ([^\s]+)$/i.exec(authorization)
        : null

    if(!match || match[1].length > 4096){
        return responderJSON(res, 401, {
            error: 'missing_or_invalid_token'
        })
    }

    const accessToken = match[1]

    try{
        const response = await fetch(
            'https://discord.com/api/v10/oauth2/@me',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                signal: AbortSignal.timeout(8_000),
                redirect: 'error'
            }
        )

        if(response.status === 401 || response.status === 403){
            return responderJSON(res, 401, {
                error: 'invalid_access_token'
            })
        }

        if(!response.ok){
            return responderJSON(res, 502, {
                error: 'discord_validation_failed'
            })
        }

        const authorizationInfo = await response.json()

        if(authorizationInfo.aaplication?.id !== clientId){
            return responderJSON(res, 403, {
                error: 'wrong_application'
            })
        }
        if(
            !Array.isArray(authorization.scopes) ||
            !authorizationInfo.scopes.includes('identify') || 
            !/^\d{17,20}$/.test(authorizationInfo.user?.id ?? '')
        ){
            return responderJSON(res, 403, {
                error: 'identity_not_available'
            })
        }

        const discordUser = {
            id: authorizationInfo.user.id,
            username: authorizationInfo.user.username,
            global_name: authorizationInfo.user.global_name ?? null,
            avatar: authorizationInfo.user.avatar ?? null
        }

        const ticket = criarTicketIdentidade(discordUser)

        if(!ticket){
            return responderJSON(res, 503, {
                error: 'too_many_pending_tickets'
            })
        }

        return responderJSON(res, 200, {
            ticket,
            expires_in: TICKET_TTL_MS / 1000,
            user: discordUser
        })
    }catch(e){
        console.error('[Discord Identity] Erro na validação: ', e.name)

        return responderJSON(res, 502, {
            error: 'identity_validation_failed'
        })
    }
}

module.exports = { tratarIdentidadeDiscord, consumirTicketIdentidade }
