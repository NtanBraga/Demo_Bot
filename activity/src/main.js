import './assets/css/style.css'
import { DiscordSDK } from "@discord/embedded-app-sdk"
import { montarPlayerWebRTC } from './webrtcActivityPlayer'
import { montarParticipantesDiscord } from './discordParticipants'

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID

document.querySelector('#app').innerHTML = `
  <main>
    <header class="app-header">
      <div class="app-brand">
        <h1>Demo Live</h1>
        <h2>Compartilhamento de tela</h2>
      </div>

      <div
        id="discord-participants"
        class="discord-participants"
        role="group"
        aria-label="Participantes da Activity"
      ></div>

      <p id="discord-status" data-state="connecting" role="status" aria-live="polite">
        Conectando ao Discord...
      </p>
  </header>
  </main>
`

const discordStatus = document.getElementById("discord-status")

let discordAccessToken = null
let discordAuthPromise = null

async function autenticarUsuario(discordSDK){
  console.log('[OAuth] Solicitando autorização')

  const { code } = await discordSDK.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify']
  })
  if(!code) throw new Error('O Discord não retornou um codigo OAuth.')

    console.log('[OAuth] Codigo de autorização recebido.')

    const endpoint = window.location.hostname.endsWith('.discordsays.com')
      ? '/.proxy/api/token'
      : '/api/token'

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      cache: 'no-store',
      body: JSON.stringify({ code })
    })

    if(!response.ok) throw new Error(`Falha na troca OAuth HTTP ${response.status}`)

    const data = await response.json()

    if(typeof data.access_token !== 'string' || !data.access_token){
      throw new Error('Backend não retornou um access_token valido.')
    }

    console.log('[OAuth] Token recebido do backend.')

    const auth = await discordSDK.commands.authenticate({
      access_token: data.access_token
    })

    if(!auth?.user?.id){
      throw new Error("O Discord não confirmou a autenticação")
    }

    console.log('[OAuth] Usuario autenticado:', auth.user.username)

    return data.access_token
}

async function obterTicketDiscord(){
  if (!discordAccessToken && discordAuthPromise) {
    discordAccessToken = await discordAuthPromise
  }

  if (!discordAccessToken) {
    throw new Error('Autenticação Discord indisponível.')
  }

  const endpoint = window.location.hostname.endsWith('.discordsays.com')
    ? '/.proxy/api/identity'
    : '/api/identity'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${discordAccessToken}`
    },
    cache: 'no-store'
  })
  if(!response.ok) throw new Error(`Falha ao obter identidade Discord: HTTP ${response.status}`)

  const result = await response.json()

  if(typeof result.ticket !== 'string' || !result.ticket){
    throw new Error('O backend não retornou um ticket valido.')
  }

  console.log('[Discord Identity] Ticket temporario recebido.')

  return result.ticket
}

async function iniciarActivity(){
  try{

    const params = new URLSearchParams(window.location.search)

    if(!params.has("frame_id")) {
      discordStatus.textContent = "Modo navegador: abra esta Activity pelo Discord"
      console.log("[Atividade] Executando fora do discord")

      return
    }

    if(!CLIENT_ID) throw new Error("ClientID não configurado.")

    const discordSDK = new DiscordSDK(CLIENT_ID)

    await discordSDK.ready()



    discordStatus.dataset.state = 'connecting'
    discordStatus.textContent = "Autenticando no Discord..."

    const container = document.querySelector("#app main")
    const participantsContainer = document.querySelector('#discord-participants')

    discordAuthPromise = autenticarUsuario(discordSDK)

    montarPlayerWebRTC(container, CLIENT_ID, obterTicketDiscord)

    try{
      discordAccessToken = await discordAuthPromise

      discordStatus.dataset.state = 'connected'
      discordStatus.textContent = "Discord conectado."

      await montarParticipantesDiscord(participantsContainer, discordSDK)
    }catch(e){
      console.error('[OAuth] Erro na autenticação: ', e)

      discordStatus.dataset.state = 'error'
      discordStatus.textContent = 'Autorização pendente'
    }

  }catch(e){
    console.error("[Atividade] Erro: ", e)
    discordStatus.dataset.state = 'error'
    discordStatus.textContent = "Não foi possivel conectar ao Discord"
  }
}

iniciarActivity()