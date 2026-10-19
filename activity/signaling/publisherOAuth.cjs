
'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const PENDING_TTL_MS = 5 * 60_000

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000

const pending = new Map()

const database = new DatabaseSync(
    path.join(__dirname, 'publisher-sessions.sqlite')
)

database.exec(`
    CREATE TABLE IF NOT EXISTS publisher_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        global_name TEXT,
        avatar TEXT,
        expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS publisher_sessions_expiration
    ON publisher_sessions(expires_at);
`)

const findSession = database.prepare(`
    SELECT *
    FROM publisher_sessions
    WHERE token_hash = ?
`)

const insertSession = database.prepare(`
    INSERT INTO publisher_sessions (
        token_hash,
        user_id,
        username,
        global_name,
        avatar,
        expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
`)

const deleteSession = database.prepare(`
    DELETE FROM publisher_sessions
    WHERE token_hash = ?
`)

const deleteExpiredSessions = database.prepare(`
    DELETE FROM publisher_sessions
    WHERE expires_at <= ?
`)

const countSessions = database.prepare(`
    SELECT COUNT(*) AS total
    FROM publisher_sessions
`)

function hashSessionToken(token) {
    return crypto.createHash('sha256')
        .update(token)
        .digest('hex')
}
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

    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    
    const tokenHash = hashSessionToken(token)

    const session = findSession.get(tokenHash)

    if (!session) return null

    if (Date.now() >= session.expires_at) {
        deleteSession.run(tokenHash)
        return null
    }

    return {
        user: {
            id: session.user_id,
            username: session.username,
            global_name: session.global_name,
            avatar: session.avatar
        },
        expiresAt: session.expires_at
    }
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

            deleteExpiredSessions.run(Date.now())

            if (countSessions.get().total >= 200) {
                return json(res, 503, {
                    error: 'too_many_sessions'
                })
            }

            const sessionToken = crypto.randomBytes(32).toString('base64url')

            const user = {
                id: identity.user.id,
                username: identity.user.username,
                global_name: identity.user.global_name ?? null,
                avatar: identity.user.avatar ?? null
            }

            insertSession.run(
                hashSessionToken(sessionToken),
                user.id,
                user.username,
                user.global_name,
                user.avatar,
                Date.now() + SESSION_TTL_MS
            )

            res.writeHead(302, {
                Location: '/transmitirWebRTC.html',
                'Set-Cookie': [
                    `${STATE_COOKIE}=; ` +
                    'Path=/api/publisher; ' +
                    'Max-Age=0; HttpOnly; Secure; SameSite=Lax',

                    `${SESSION_COOKIE}=${sessionToken}; ` +
                    `Path=/; Max-Age=${SESSION_TTL_MS / 1000}; ` +
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
