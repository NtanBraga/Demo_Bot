const {criarCredencialSFU,verificarCredencialSFU} = require('./sfuAccess.cjs')

const token = criarCredencialSFU({
    roomId: 'sala-a',
    role: 'viewer',
    userId: '123456789012345678'
})

console.log('Sala correta:',
    verificarCredencialSFU(token, {
        roomId: 'sala-a',
        role: 'viewer'
    }) !== null
)

console.log('Sala errada recusada:',
    verificarCredencialSFU(token, {
        roomId: 'sala-b',
        role: 'viewer'
    }) === null
)

console.log('Publisher recusado:',
    verificarCredencialSFU(token, {
        roomId: 'sala-a',
        role: 'publisher'
    }) === null
)