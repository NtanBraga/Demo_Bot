Option Explicit

Dim shell, ssh, chave, comando, resultado

Set shell = CreateObject("WScript.Shell")

' Localização do OpenSSH no Windows
ssh = "C:\Windows\System32\OpenSSH\ssh.exe"

' Caminho completo da chave privada da Azure
chave = "C:\Users\natan\Documents\Demo_key.pem"

' Comando SSH
comando = """" & ssh & """" & _
    " -i """ & chave & """" & _
    " -N -T" & _
    " -o BatchMode=yes" & _
    " -o ExitOnForwardFailure=yes" & _
    " -o ConnectTimeout=10" & _
    " -o ServerAliveInterval=30" & _
    " -o ServerAliveCountMax=3" & _
    " -L 127.0.0.1:3004:127.0.0.1:3004" & _
    " azureuser@20.195.177.34"

' Executa oculto
resultado = shell.Run(comando, 0, True)

WScript.Quit resultado