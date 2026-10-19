'use strict'

const crypto = require('node:crypto')

const TTL_MS = 30_000
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const USER_PATTERN = /^\d{17,20}$/
const ROLES = new Set(['publisher', 'viewer'])

function getSecret() {
    const hex = process.env.SFU_GRANT_SECRET

    if (typeof hex !== 'string' || !/^[a-fA-F0-9]{64}$/.test(hex)) {
        throw new Error('SFU_GRANT_SECRET deve conter 64 caracteres hexadecimais')
    }

    return Buffer.from(hex, 'hex')
}

function criarCredencialSFU({ roomId, role, userId }) {
    if (!ROOM_PATTERN.test(roomId) || !ROLES.has(role) || !USER_PATTERN.test(userId)) {
        throw new Error('Dados de autorizacao SFU invalidos')
    }

    const claims = {
        v: 1,
        iss: 'demo-live-relay',
        aud: 'demo-live-sfu',
        roomId,
        role,
        userId,
        jti: crypto.randomBytes(16).toString('base64url'),
        exp: Date.now() + TTL_MS
    }

    const body = Buffer.from(JSON.stringify(claims)).toString('base64url')

    const signature = crypto
        .createHmac('sha256', getSecret())
        .update(body)
        .digest('base64url')

    return `${body}.${signature}`
}

function verificarCredencialSFU(token, { roomId, role } = {}) {
    if (typeof token !== 'string' || token.length > 2048) return null

    const parts = token.split('.')

    if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null

    const [body, signature] = parts

    const actual = Buffer.from(signature, 'base64url')

    const expected = crypto.createHmac('sha256', getSecret()).update(body).digest()

    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null

    let claims

    try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
        return null
    }

    const now = Date.now()

    if (
        claims?.v !== 1 ||
        claims.iss !== 'demo-live-relay' ||
        claims.aud !== 'demo-live-sfu' ||
        !ROOM_PATTERN.test(claims.roomId) ||
        !ROLES.has(claims.role) ||
        !USER_PATTERN.test(claims.userId) ||
        typeof claims.jti !== 'string' ||
        !/^[A-Za-z0-9_-]{22}$/.test(claims.jti) ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp <= now ||
        claims.exp > now + TTL_MS
    ) return null

    if (roomId !== undefined && claims.roomId !== roomId) return null

    if (role !== undefined && claims.role !== role) return null

    return claims
}

module.exports = { criarCredencialSFU,verificarCredencialSFU }