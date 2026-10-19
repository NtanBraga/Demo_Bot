'use strict'

const {criarCredencialSFU,verificarCredencialSFU} = require('./sfuAccess.cjs')

const modo = process.argv[2]

if (modo === 'emitir') {
    const token = criarCredencialSFU({
        roomId: 'sala-a',
        role: 'viewer',
        userId: '123456789012345678'
    })

    console.log(token)

} else if (modo === 'verificar') {
    let entrada = ''

    process.stdin.setEncoding('utf8')

    process.stdin.on('data', trecho => {
        entrada += trecho

        if (entrada.length > 4096) {
            console.error('Credencial excessivamente grande')
            process.exit(1)
        }
    })

    process.stdin.on('end', () => {
        const token = entrada.trim()

        const correto = verificarCredencialSFU(token, {
            roomId: 'sala-a',
            role: 'viewer'
        })

        const salaErrada = verificarCredencialSFU(token, {
            roomId: 'sala-b',
            role: 'viewer'
        })

        const papelErrado = verificarCredencialSFU(token, {
            roomId: 'sala-a',
            role: 'publisher'
        })

        console.log('Credencial correta:', correto !== null)
        console.log('Outra sala recusada:', salaErrada === null)
        console.log('Publisher recusado:', papelErrado === null)

        if (!correto || salaErrada || papelErrado) {
            process.exitCode = 1
        }
    })

} else {
    console.error('Modo esperado: emitir ou verificar')
    process.exitCode = 1
}