# NIX 0.2.12 — correção dos falsos erros no editor

## Causa
O NIX já identificava `.ts`, `.tsx`, `.js`, `.jsx` e `.py` pela extensão. O problema não era a linguagem do arquivo.

O Monaco possui um TypeScript worker executando dentro do renderer. Esse worker não possui acesso direto ao filesystem real do workspace Electron, aos `node_modules` e à árvore completa de `tsconfig` de um monorepo. Por isso imports válidos como `react` e imports relativos eram marcados como erros de resolução.

## Correção
- Configuração explícita do TypeScript/JavaScript do Monaco para ESNext/Node e JSX React.
- Validação de sintaxe continua ativa.
- Validação semântica isolada do Monaco foi desativada para TS/JS, eliminando falsos `Cannot find module`.
- O diagnóstico semântico real deve vir do toolchain do projeto (`tsc`, eslint, pyright, etc.), executado sobre o filesystem verdadeiro.
- Detecção de linguagem ampliada para `.mts`, `.cts`, `.mjs` e `.cjs`.
