# NIX 0.2.3 — correção da suíte de testes

Correções aplicadas a partir da execução real da v0.2.2 no Windows:

- Corrigida condição de corrida na aprovação: o `pendingApproval` agora é armado antes da publicação de `approval.requested`.
- Corrigido roteamento local Free Tier para reconhecer comandos como `Corrija ...` como `medium`.
- `RunEventBus` agora limita o histórico a 200 eventos por execução e 60 execuções em memória, priorizando a retenção de históricos mais ricos.
- Atualizado o teste de saída grande de ferramenta para refletir o Context Budget do Groq Free Tier: o request ao modelo é compactado, assim como o evento diagnóstico, evitando estourar TPM/contexto.
- O script `TESTAR_NIX_WINDOWS.ps1` executa Vitest em modo `--run`, para seguir automaticamente ao build quando os testes passarem.

## Validação

Execute no PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\TESTAR_NIX_WINDOWS.ps1
```

A sequência esperada é:

1. npm install
2. typecheck
3. tests (modo run, sem ficar em watch)
4. build

Depois:

```powershell
npm run dev
```
