# NIX 0.2.7 — correção do chat agêntico para tarefas de avaliação/UX

## Problema observado
Pedidos concretos como "Avalia todo esse projeto... melhorias de UX na tela de login" podiam terminar com uma saudação genérica, mesmo com o agente e a Groq conectados.

## Causa
A proteção da 0.2.4 só forçava inspeção do workspace para um conjunto restrito de verbos (revisar/analisar/verificar/validar/diagnosticar/mapear/inspecionar). O verbo "avaliar" e pedidos de melhoria/UX não eram classificados como tarefas dependentes do workspace. Assim, o primeiro turno podia ficar em `tool_choice: auto` e o modelo podia encerrar sem consultar o projeto.

## Correções
- Classificação ampliada para avaliação, melhoria, sugestão, identificação, implementação, correção, refatoração, otimização, testes e explicação quando o pedido menciona projeto/código/componentes/telas/UI/UX/login/API etc.
- Primeira etapa dessas tarefas força `workspace_overview`.
- Guard rail contra respostas genéricas: se o modelo responder "Como posso ajudar?", "Estou pronto para ajudar" ou equivalente em uma tarefa concreta, o NIX não encerra a execução.
- Nessa situação, o próximo turno usa `tool_choice: required`, obrigando uma ferramenta relevante do workspace antes de permitir a resposta final.
- Limite de duas recuperações para evitar loops.
- Testes de regressão para o caso real de UX/login e para a recuperação de resposta genérica.
