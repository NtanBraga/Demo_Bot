
'use strict'

const crypto = require('node:crypto')

const PENDING_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 12 * 60 * 60_000

const pending = new Map()
const sessions = new Map()

const STATE_COOKIE = 'demo_pub_state'
const SESSION_COOKIE = '__Host-demo_publisher'

function getCookie(req, name) {
    const part = (req.headers.cookie || '')
        .split(';')
        .map(value => value.trim())
        .find(value => value.startsWith(name + '='))

    return part ? part.slice(name.length + 1) : null
}

function json(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    })

    res.end(JSON.stringify(data))
}

function getPublisherSession(req) {
    const token = getCookie(req, SESSION_COOKIE)
    const session = token ? sessions.get(token) : null

    if (!session) return null

    if (Date.now() >= session.expiresAt) {
        sessions.delete(token)
        return null
    }

    return session
}

async function tratarPublisherOAuth(req, res) {
    if (req.method !== 'GET') {
        return json(res, 405, {
            error: 'method_not_allowed'
        })
    }

    const pathname = new URL(req.url,'http://localhost').pathname

    if (pathname === '/api/publisher/me') {
        const session = getPublisherSession(req)

        return json(res, 200, session
            ? {
                authenticated: true,
                user: session.user
            }
            : {
                authenticated: false
            }
        )
    }

    const clientId = process.env.DISCORD_CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET
    const redirectUri = process.env.PUBLISHER_OAUTH_REDIRECT_URI

    console.log('[Publisher OAuth] Configuração:', {
        clientId: Boolean(clientId),
        clientSecret: Boolean(clientSecret),
        redirectUri: redirectUri || 'NÃO CONFIGURADO'
    })

    if (
        !clientId ||
        !clientSecret ||
        !redirectUri?.startsWith('https://')
    ) {
        return json(res, 503, {
            error: 'publisher_oauth_not_configured'
        })
    }

    if (pathname === '/api/publisher/login') {
        if (pending.size >= 100) {
            return json(res, 503, {
                error: 'too_many_pending_logins'
            })
        }

        const state = crypto.randomBytes(32)
            .toString('base64url')

        pending.set(
            state,
            Date.now() + PENDING_TTL_MS
        )

        const timer = setTimeout(() => {
            pending.delete(state)
        }, PENDING_TTL_MS)

        timer.unref()

        const url = new URL(
            'https://discord.com/oauth2/authorize'
        )

        url.search = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            scope: 'identify',
            redirect_uri: redirectUri,
            state
        }).toString()

        res.writeHead(302, {
            Location: url.toString(),
            'Set-Cookie':
                `${STATE_COOKIE}=${state}; ` +
                'Path=/api/publisher; ' +
                'Max-Age=300; ' +
                'HttpOnly; Secure; SameSite=Lax',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer'
        })

        return res.end()
    }

    if (pathname === '/api/publisher/callback') {
        const params = new URL(
            req.url,
            'http://localhost'
        ).searchParams

        const state = params.get('state')
        const code = params.get('code')
        const cookieState = getCookie(req, STATE_COOKIE)
        const expiration = pending.get(state)

        const validState = Boolean(
            state &&
            cookieState &&
            state.length === cookieState.length &&
            crypto.timingSafeEqual(
                Buffer.from(state),
                Buffer.from(cookieState)
            ) &&
            expiration &&
            Date.now() < expiration
        )

        if (
            !validState ||
            !code ||
            code.length > 2048
        ) {
            return json(res, 400, {
                error: 'invalid_or_expired_oauth_state'
            })
        }

        pending.delete(state)

        try {
            const tokenResponse = await fetch(
                'https://discord.com/api/v10/oauth2/token',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: redirectUri
                    }),
                    signal: AbortSignal.timeout(10_000)
                }
            )

            if (!tokenResponse.ok) {
                return json(res, 401, {
                    error: 'discord_code_exchange_failed'
                })
            }

            const tokens = await tokenResponse.json()

            if (typeof tokens.access_token !== 'string') {
                return json(res, 502, {
                    error: 'discord_token_missing'
                })
            }

            const identityResponse = await fetch(
                'https://discord.com/api/v10/oauth2/@me',
                {
                    headers: {
                        Authorization:
                            `Bearer ${tokens.access_token}`
                    },
                    signal: AbortSignal.timeout(10_000)
                }
            )

            if (!identityResponse.ok) {
                return json(res, 502, {
                    error: 'discord_identity_fetch_failed'
                })
            }

            const identity = await identityResponse.json()

            if (
                identity.application?.id !== clientId ||
                !identity.scopes?.includes('identify') ||
                !/^\d{17,20}$/.test(identity.user?.id || '')
            ) {
                return json(res, 403, {
                    error: 'discord_identity_invalid'
                })
            }

            if (sessions.size >= 200) {
                return json(res, 503, {
                    error: 'too_many_sessions'
                })
            }

            const sessionToken = crypto.randomBytes(32)
                .toString('base64url')

            sessions.set(sessionToken, {
                user: {
                    id: identity.user.id,
                    username: identity.user.username,
                    global_name:
                        identity.user.global_name ?? null,
                    avatar: identity.user.avatar ?? null
                },
                expiresAt: Date.now() + SESSION_TTL_MS
            })

            const timer = setTimeout(() => {
                sessions.delete(sessionToken)
            }, SESSION_TTL_MS)

            timer.unref()

            res.writeHead(302, {
                Location: '/transmitirWebRTC.html',
                'Set-Cookie': [
                    `${STATE_COOKIE}=; ` +
                    'Path=/api/publisher; ' +
                    'Max-Age=0; HttpOnly; Secure; SameSite=Lax',

                    `${SESSION_COOKIE}=${sessionToken}; ` +
                    'Path=/; Max-Age=43200; ' +
                    'HttpOnly; Secure; SameSite=Lax'
                ],
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer'
            })

            return res.end()

        } catch (error) {
            console.error(
                '[Publisher OAuth] Erro:',
                error.name
            )

            return json(res, 502, {
                error: 'publisher_oauth_failed'
            })
        }
    }

    return json(res, 404, {
        error: 'not_found'
    })
}

module.exports = {
    tratarPublisherOAuth,
    getPublisherSession
}
