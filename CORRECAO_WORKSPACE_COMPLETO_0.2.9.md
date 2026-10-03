# NIX 0.2.9 — análise completa do workspace/monorepo

## Problema observado
Em workspaces grandes, o NIX conseguia indexar arquivos recursivamente, mas o resumo enviado ao agente não deixava explícitos todos os subprojetos. Em um monorepo como o PayHub, isso fazia o modelo tratar a raiz como se fosse o projeto inteiro e podia não considerar explicitamente `apps/api`, `apps/dashboard` e `apps/mobile`.

Além disso, consultas de avaliação como “Avalia todo esse projeto e sugere melhorias de UX na tela de login” ainda deixavam `verify_workspace`/`run_command` disponíveis. O modelo podia escolher rodar testes sem necessidade e, no Windows, `npm.cmd` podia falhar via `spawn` sem shell com `ENOENT/EINVAL`.

## Correções
- `WorkspaceIntelligenceService` agora detecta projetos/subprojetos por manifestos e mostra raiz, tipo, nome, scripts e quantidade de arquivos.
- O limite do índice foi ampliado de 10.000 para 20.000 arquivos, mantendo exclusão de `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, caches e artefatos.
- Nova tool `workspace_projects` lista os projetos detectados de forma estruturada.
- O grounding local usa `workspace_overview` + `workspace_projects` antes da primeira chamada Groq.
- Buscas temáticas, como `login`, são executadas por subprojeto para que `apps/api`, `apps/dashboard`, `apps/mobile` etc. sejam considerados separadamente.
- `search_files(path=...)` agora pesquisa diretamente dentro da pasta solicitada, em vez de buscar globalmente e filtrar os primeiros resultados.
- Pedidos somente de análise/revisão/UX não disponibilizam `run_command` nem `verify_workspace` ao modelo, salvo quando o usuário pede execução/testes explicitamente.
- O compactador de contexto passa a preservar a mensagem atual do usuário mesmo quando a evidência local foi anexada depois dela.
- No Windows, executáveis `.cmd/.bat` passam a usar shell ao serem disparados pelo command runner, evitando falhas conhecidas de spawn com `npm.cmd`.

## Regressões adicionadas
- detecção de monorepo com `apps/api`, `apps/dashboard` e `apps/mobile`;
- busca com escopo real em subpasta;
- análise UX percorre projetos aninhados e não oferece comandos de verificação;
- compactação mantém a solicitação atual do usuário.

## Validação neste ambiente
- parser TypeScript: 103 arquivos TS/TSX, 0 erros de sintaxe;
- pacote ZIP verificado após criação;
- typecheck/test/build completos devem ser executados no Windows pelo `TESTAR_NIX_WINDOWS.ps1`, pois este ambiente não possui as dependências npm instaladas.
