$ErrorActionPreference = 'Stop'

Write-Host '== NIX: instalando dependencias ==' -ForegroundColor Cyan
npm ci

Write-Host '== NIX: typecheck ==' -ForegroundColor Cyan
npm run typecheck

Write-Host '== NIX: testes ==' -ForegroundColor Cyan
npm test -- --run

Write-Host '== NIX: build ==' -ForegroundColor Cyan
npm run build

if ($env:RUN_E2E -eq '1') {
  Write-Host '== NIX: E2E ==' -ForegroundColor Cyan
  npm run test:e2e
} else {
  Write-Host 'E2E ignorado. Para executar: $env:RUN_E2E="1"; .\scripts\verify-local.ps1' -ForegroundColor Yellow
}

Write-Host 'Verificacao concluida.' -ForegroundColor Green
