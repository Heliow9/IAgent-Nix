# NIX IA Agent — implementação 03/10/2026

Esta versão consolida as correções anteriores e adiciona a arquitetura de inteligência discutida.

## Implementado

- Skill Engine nativo com skills de brainstorming, planejamento, debugging sistemático, TDD, revisão, verificação, inteligência de workspace e revisão por subagente.
- Compatibilidade com skills externas em `.nix/skills`, `.superpowers/skills`, `NIX_SUPERPOWERS_DIR` e `~/.config/nix/skills`.
- Workspace Intelligence com índice local de arquivos, símbolos e grafo de imports, busca de símbolos e arquivos relacionados.
- Orquestração com delegação para papéis planner/reviewer/debugger/tester/architect.
- Verification Engine para executar checks relevantes antes da conclusão.
- Memória persistente por projeto em `.nix/memory.json`.
- Ferramentas de inteligência disponíveis ao agente: workspace overview, símbolos, arquivos relacionados, memória, verificação, delegação e MCP.
- Central de Execuções na barra lateral.
- Busca textual + busca por símbolos.
- Git: status, stage, unstage, commit, branches/checkout e diff via IPC.
- Configurações do NIX: roteamento automático/rápido/profundo, orçamento de contexto, concorrência, verificação automática, skills e MCP.
- MCP stdio: cadastro de servidores, inicialização, descoberta de tools e chamada de tool.
- Roteamento multi-modelo fast/deep/auto.
- Modo de permissão `autopilot` adicionado ao contrato/política.
- Contexto enriquecido com skills, memória e resumo do índice do workspace.
- Fluxo de engenharia no prompt do agente: entender → inspecionar → planejar → implementar → verificar → revisar → resumir.
- Preservadas as correções anteriores: aplicação/rejeição em lote, aprovação/recusa em lote, imports clicáveis/resolução de imports, terminal com espaço e consolidação de propostas por arquivo para reduzir conflitos.

## Observação sobre Superpowers

O NIX possui um Skill Engine próprio e compatível com skills no formato Markdown. Ele pode carregar automaticamente um diretório Superpowers existente via `.superpowers/skills` ou `NIX_SUPERPOWERS_DIR`. As skills essenciais equivalentes estão incorporadas como NIX Core Skills; o repositório de terceiros não foi copiado para dentro do pacote.

## Validação executada neste ambiente

- Todos os arquivos `.ts`/`.tsx` foram submetidos ao parser/transpilador TypeScript global: **0 erros sintáticos**.
- `npm run typecheck/test/build` não pôde ser concluído aqui porque as dependências do projeto não estão materializadas no ambiente e o `npm ci` excedeu o tempo de acesso ao registry.

No Windows do projeto, execute:

```powershell
npm install
npm run typecheck
npm test -- --run
npm run build
```

Se algum comando falhar, use a saída completa para a próxima correção.
