
Option Explicit

Dim shell, projeto, caddy, comando, resultado

Set shell = CreateObject("WScript.Shell")

' Pasta principal do Demo Live
projeto = "F:\demobot\activity"

' Localização do Caddy
caddy = projeto & ".\tools\caddy.exe"

' Define o diretório de trabalho
shell.CurrentDirectory = projeto

' Comando para iniciar o servidor de produção
comando = """" & caddy & """" & _
          " run --config """ & projeto & ".\Caddyfile.txt""" & _
          " --adapter caddyfile"

' Executa oculto e aguarda o processo
resultado = shell.Run(comando, 0, True)

WScript.Quit resultado
