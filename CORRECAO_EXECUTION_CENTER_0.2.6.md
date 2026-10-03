# NIX 0.2.6 — correção da tela preta na Central de Execuções

## Sintoma
Ao clicar no ícone `✦` da barra lateral, o renderer podia ficar preto e o DevTools mostrava:

- `The result of getSnapshot should be cached to avoid an infinite loop`
- `Maximum update depth exceeded`
- erro no componente `ExecutionCenter`

## Causa raiz
`ExecutionCenter` usava este selector Zustand:

```ts
useIdeStore((s) => Object.values(s.agentRuns))
```

`Object.values()` cria um novo array em toda leitura do store. Com React 19 + `useSyncExternalStore`, isso produz um snapshot derivado sem estabilidade referencial e pode iniciar um loop de renderização infinito.

## Correção
- o selector agora retorna apenas `state.agentRuns`, que é estável entre atualizações;
- `Object.values(agentRuns)` é derivado com `useMemo`;
- as métricas do painel também são memoizadas;
- foi adicionado um Error Boundary só para o painel lateral, evitando que um erro futuro derrube a interface inteira;
- foi incluído teste de regressão para a Central de Execuções;
- versão atualizada para `0.2.6`.

## Comportamento esperado
Ao clicar em `✦`, a Central de Execuções abre normalmente. Se um painel lateral apresentar uma falha inesperada, o NIX mantém editor, terminal e chat visíveis e oferece o botão **Voltar ao Explorador**.
