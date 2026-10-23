
'use strict';

const APPLICATION_ID = process.env.DEMO_APPLICATION_ID;
const ACTIVITY_TOKEN = process.env.DEMO_ACTIVITY_BOT_TOKEN;
const BRIDGE_SECRET = process.env.DEMO_BRIDGE_SECRET;

const BRIDGE_URL = process.env.DEMO_BRIDGE_URL || "http://127.0.0.1:3105/demo-live";
const INTERVALO = 30_000;

const sessoes = new Map();

if (
    !APPLICATION_ID ||
    !ACTIVITY_TOKEN ||
    !BRIDGE_SECRET ||
    BRIDGE_SECRET.length < 32
) {
    throw new Error(
        "[Demo Live] Configure as credenciais de integração."
    );
}

function responder(res, status, dados) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(dados));
}

async function consultarInstancia(instanceId) {
    const response = await fetch(
        `https://discord.com/api/v10/applications/${APPLICATION_ID}/activity-instances/${encodeURIComponent(instanceId)}`,
        {
            headers: {
                Authorization: `Bot ${ACTIVITY_TOKEN}`
            },
            signal: AbortSignal.timeout(8000)
        }
    );

    if (response.status === 404) return null;

    if (!response.ok) {
        throw new Error(
            `Falha na API de instâncias: HTTP ${response.status}`
        );
    }

    return response.json();
}

async function consultarUsuario(accessToken) {
    const response = await fetch(
        "https://discord.com/api/v10/users/@me",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            signal: AbortSignal.timeout(8000)
        }
    );

    if (!response.ok) return null;

    return response.json();
}

async function avisarBlinBlin(tipo, sessao) {
    const response = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-demo-secret": BRIDGE_SECRET
        },
        body: JSON.stringify({
            tipo,
            guildId: sessao.guildId,
            instanceId: sessao.instanceId
        }),
        signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
        throw new Error(
            `BlinBlin retornou HTTP ${response.status}`
        );
    }
}

async function tratarSessaoDemo(req, res) {
    if (req.method !== "POST") {
        return responder(res, 405, {
            error: "Método não permitido"
        });
    }

    try {
        const authorization = req.headers.authorization || "";

        if (
            !authorization.startsWith("Bearer ") ||
            authorization.length > 4096
        ) {
            return responder(res, 401, {
                error: "Autenticação necessária"
            });
        }

        const accessToken = authorization.slice(7);

        let body = "";

        for await (const chunk of req) {
            body += chunk.toString();

            if (body.length > 2048) {
                return responder(res, 413, {
                    error: "Requisição muito grande"
                });
            }
        }

        const { instanceId } = JSON.parse(body);

        if (
            typeof instanceId !== "string" ||
            !instanceId ||
            instanceId.length > 256
        ) {
            return responder(res, 400, {
                error: "instanceId inválido"
            });
        }

        const usuario = await consultarUsuario(accessToken);

        if (!usuario?.id) {
            return responder(res, 401, {
                error: "Usuário não autenticado"
            });
        }

        const instancia = await consultarInstancia(instanceId);

        if (
            !instancia ||
            instancia.application_id !== APPLICATION_ID ||
            instancia.instance_id !== instanceId ||
            instancia.location?.kind !== "gc" ||
            !/^\d{17,20}$/.test(instancia.location?.guild_id || "") ||
            !/^\d{17,20}$/.test(instancia.location?.channel_id || "") ||
            !Array.isArray(instancia.users) ||
            !instancia.users.includes(usuario.id)
        ) {
            return responder(res, 403, {
                error: "Sessão da Demo Live não autorizada"
            });
        }

        const novaSessao = !sessoes.has(instanceId);

        const sessao = {
            instanceId,
            guildId: instancia.location.guild_id,
            channelId: instancia.location.channel_id
        };

        sessoes.set(instanceId, sessao);

        let bridgeNotificado = null;

        if (novaSessao) {
            console.log(`[Demo Live] Sessão iniciada: ${instanceId}`);

            try {
                await avisarBlinBlin("start", sessao);
                bridgeNotificado = true;

            } catch (error) {
                bridgeNotificado = false;

                console.error(
                    "[Demo Live] Falha ao avisar BlinBlin:",
                    error.message
                );
            }
        }

        return responder(res, 200, {
            ok: true,
            instanceId,
            bridgeNotificado
        });

    } catch (error) {
        console.error("[Demo Live] Erro na sessão:", error);

        return responder(res, 400, {
            error: "Não foi possível registrar a sessão"
        });
    }
}

let monitorando = false;

async function monitorarSessoes() {
    if (monitorando) return;

    monitorando = true;

    try {
        for (const [instanceId, sessao] of sessoes) {
            try {
                const instancia = await consultarInstancia(instanceId);

                const encerrada =
                    !instancia ||
                    instancia.application_id !== APPLICATION_ID ||
                    instancia.location?.guild_id !== sessao.guildId ||
                    !Array.isArray(instancia.users) ||
                    instancia.users.length === 0;

                if (encerrada) {
                    if (sessoes.get(instanceId) !== sessao) {
                        continue;
                    }

                    sessoes.delete(instanceId);

                    console.log(
                        `[Demo Live] Sessão encerrada: ${instanceId}`
                    );

                    await avisarBlinBlin("end", sessao);
                    continue;
                }   

                await avisarBlinBlin("start", sessao);

            } catch (error) {
                console.error(
                    `[Demo Live] Monitoramento ${instanceId}:`,
                    error.message
                );
            }
        }
    } finally {
        monitorando = false;
    }
}

function iniciarMonitoramentoDemo() {
    const timer = setInterval(
        monitorarSessoes,
        INTERVALO
    );

    timer.unref();

    console.log("[Demo Live] Monitoramento de sessões iniciado.");
}

module.exports = {
    tratarSessaoDemo,
    iniciarMonitoramentoDemo
};
