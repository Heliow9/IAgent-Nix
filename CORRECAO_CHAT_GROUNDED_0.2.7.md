# NIX 0.2.7 — correção de grounding do chat

Corrige respostas genéricas em pedidos naturais de análise do projeto, como "Avalia todo esse projeto...".

## Alterações
- amplia o reconhecimento de pedidos que dependem do workspace (`avaliar`, `melhorar`, `sugerir`, `recomendar`, `identificar`, etc.);
- reconhece assuntos como UX/UI, tela, login, interface, componente, frontend/backend, rotas e endpoints;
- força `workspace_overview` antes da primeira resposta nesses pedidos;
- adiciona guarda contra saudações genéricas em tarefas que exigem inspeção real do código;
- adiciona teste de regressão com a frase observada em runtime;
- versão atualizada para 0.2.7.
