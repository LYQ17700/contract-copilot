$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
Write-Host '启动 合同避坑助手 demo → http://127.0.0.1:5178/' -ForegroundColor Cyan
node server.mjs
