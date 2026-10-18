import { Events } from "@discord/embedded-app-sdk"

const MAX_VISIBLE = 7

export async function montarParticipantesDiscord(container, discordSDK){
    if(!container) throw new Error('Container dos participantes não encontrado.')

        function criarAvatar(user){
            const name = user.global_name || user.username || 'Participante'

            const avatar = document.createElement('span')
            avatar.className = 'discord-participant'
            avatar.title = name
            avatar.setAttribute('role', 'img')
            avatar.setAttribute('aria-label', name)

            const fallback = document.createElement('span')
            fallback.className = 'discord-participant__fallback'
            fallback.textContent = name.charAt(0).toUpperCase() || '?'

            avatar.appendChild(fallback)

            if(typeof user.id === 'string' && 
                /^\d{17,20}$/.test(user.id) &&
                typeof user.avatar === 'string' &&
                /^[a-zA-Z0-9_]+$/.test(user.avatar)
            ){
                const img = document.createElement('img')
                img.className = 'discord-participant__image'
                img.alt = ''
                img.loading = 'lazy'
                img.decoding = 'async'
                img.src =  `https://cdn.discordapp.com/avatars/` + `${user.id}/${user.avatar}.webp?size=64`

                img.onerror = () => img.remove()

                avatar.appendChild(img)
            }
            return avatar
        }

        function atualizarParticipantes(data){
            const participants = Array.isArray(data?.participants)
                ? data.participants.filter(user => user && typeof user.id === 'string')
                : []
            const unique = [
                ...new Map(participants.map(user => [user.id, user])).values()
            ]
            container.replaceChildren()

            container.setAttribute('aria-label', `${unique.length} participante(s) na Atividade`)
        
            if(unique.length === 0){
                console.log('[Discord] Nenhum participante retornado pelo SDK.')
                return
            }

            const stack = document.createElement('div')
            stack.className = 'discord-participants__stack'

            for(const user of unique.slice(0, MAX_VISIBLE)){
                stack.appendChild(criarAvatar(user))
            }

            const remaining = unique.length - MAX_VISIBLE

            if(remaining > 0){
                const extra = document.createElement('span')
                extra.className = 'discord-participant discord-participant--extra'
                extra.textContent = `+${remaining}`
                extra.title = `${remaining} participante(s) adicional(is)`

                stack.appendChild(extra)
            }
            container.appendChild(stack)
            console.log(`[Discord] Participantes atualizados: ${unique.length}`)
        }

        let recebeuAtualizacao = false

        function onParticipantsUpdate(data){
            recebeuAtualizacao = true
            atualizarParticipantes(data)
        }

        try{
            await discordSDK.subscribe(
                Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
                onParticipantsUpdate
            )
            console.log('[Discord] Eventos de participantes registrados.')
        }catch(e){
            console.warn('[Discord] Falha na incrição: ', e)
        }

        try{
            const getParticipants = 
                discordSDK.commands.getActivityInstanceConnectedParticipants ??
                discordSDK.commands.getInstanceConnectedParticipants


            if(typeof getParticipants !== 'function'){
                throw new Error('Consulta de participantes indisponivel no SDK.')
            }

            const result = await getParticipants.call(discordSDK.commands)

            if(!recebeuAtualizacao){
                atualizarParticipantes(result)
            }
        }catch(e){
            console.error('[Discord] Erro ao consultar participantes: ', e)
        }
}