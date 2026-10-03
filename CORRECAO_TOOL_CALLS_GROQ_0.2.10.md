# NIX 0.2.10 — Tool calls Groq resilientes

## Problema observado

O Groq podia encerrar a requisição com HTTP 400 antes de o NIX receber a chamada de ferramenta quando o GPT-OSS gerava argumentos que violavam o JSON Schema, por exemplo `search_files` com `query: ""` enquanto o schema exigia `minLength: 1`.

## Correções

- Ativado `disable_tool_validation` nas requisições com ferramentas, mantendo a validação estrita local no `ToolRegistry`/Zod.
- O schema enviado ao provedor continua descrevendo tipos e propriedades, mas remove restrições que transformavam pequenos erros de geração em falha fatal da requisição (`minLength`, `required`, limites, `additionalProperties`, etc.).
- Se o Groq ainda devolver erro de validação de tool call, o NIX faz um retry único abrindo apenas o schema da ferramenta apontada no erro.
- `search_files` com `query` vazio é reparado localmente a partir do prompt do usuário antes da execução.
- Adicionado `reasoning_format: hidden` para GPT-OSS.
- Resposta vazia (sem texto e sem tools) deixa de ser considerada concluída: o NIX reduz o reasoning e tenta concluir com o contexto já coletado.
- Frases negativas como `não execute testes` deixam de habilitar `run_command`/`verify_workspace`.
- Grounding local reconhece também `PWA`.

## Resultado esperado

Perguntas como `Quais as melhorias de UX podem ser aplicadas nas telas do dashboard PWA?` não devem mais derrubar a execução por `search_files.query` vazio. Se o modelo produzir um argumento imperfeito, o NIX recupera/repara localmente e continua a análise.
