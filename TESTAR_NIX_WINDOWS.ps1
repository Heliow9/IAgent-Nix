$ErrorActionPreference = 'Stop'

Write-Host 'NIX 0.2.13 - validacao local' -ForegroundColor Cyan
Write-Host 'Perfil: Groq Free Tier + openai/gpt-oss-120b' -ForegroundColor DarkCyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js nao encontrado. Instale Node.js 22 ou superior.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm nao encontrado.'
}

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Arquivo .env criado a partir de .env.example.' -ForegroundColor Yellow
  Write-Host 'Antes de usar o agente, informe sua GROQ_API_KEY no .env.' -ForegroundColor Yellow
} else {
  Write-Host 'Seu .env existente foi preservado.' -ForegroundColor Green
}

Write-Host "`n[1/4] Instalando dependencias..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }

Write-Host "`n[2/4] Typecheck..." -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck falhou.' }

Write-Host "`n[3/4] Testes..." -ForegroundColor Cyan
npm test -- --run
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }

Write-Host "`n[4/4] Build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }

Write-Host "`nTudo passou. Para abrir o NIX:" -ForegroundColor Green
Write-Host 'npm run dev' -ForegroundColor White
