---
name: analise-desempenho
description: >-
  Read-only monthly Instagram performance analysis agent for the Agendaí
  Social Studio, designed to run as an isolated cloud routine
  (`/schedule`, zero prior context) with the `Skill` tool available.
  Fetches the metrics the app already collected via
  `GET /api/analysis/source`, computes pillar/format/hook cohorts and
  raw deltas vs the previous report, then persists the result via
  `POST /api/analysis` so the piece-generation routine can read it as a
  bias signal. Never approves or publishes pieces, never edits the repo,
  never holds `META_IG_TOKEN`. Trigger phrases: "revisão mensal",
  "análise de desempenho do Instagram", "rodar análise mensal", "gerar
  relatório de análise", "analisar desempenho do conteúdo".
---

# Análise de desempenho — Agendaí Social Studio

Este skill executa a **revisão mensal de desempenho** descrita em
`docs/02-playbook-conteudo.md` §6: lê os dados que o app já coletou do
Instagram, produz uma análise por pilar/formato/hook e grava o resultado
via API para a rotina de geração de conteúdo usar como viés na próxima
rodada. Ele não escreve legenda nem `imagePrompt` — para isso, e para a
lógica de hooks/CTA/táticas por formato usada aqui, ver
`.claude/skills/agendai-social-strategist/SKILL.md`.

## Quando usar

- Executado pela rotina cloud mensal (`docs/rotina-analise.md`, agendada
  via `/schedule`), tipicamente na 1ª semana do mês, em conjunto com o
  skill `/agendai-social-strategist` (que fornece as fórmulas de hook e
  as regras de copy usadas na leitura das peças).
- Sob demanda, se o dono pedir explicitamente uma análise de desempenho
  fora do calendário mensal.
- **Não** usar para escrever peças novas nem para aprovar/publicar
  conteúdo — isso é escopo de `docs/rotina-geracao.md` e da interface de
  aprovação, respectivamente.

## Guard-rails

Esta rotina roda numa sessão de nuvem isolada, com checkout do repositório
mas **sem** contexto prévio de conversa. As regras abaixo não têm exceção:

1. **Somente leitura de dados de negócio.** Este skill nunca aprova, edita
   ou publica peças, nunca faz upload de imagem, nunca chama
   `PATCH /api/pieces/*`. A única escrita permitida é
   `POST /api/analysis` (Passo 3).
2. **Nunca edita o repositório.** Nenhum `git commit`, nenhuma edição de
   arquivo em `docs/`, `lib/`, `app/` etc. O resultado da análise só vive
   no banco, via API.
3. **Nunca detém `META_IG_TOKEN`.** Este skill não conhece nem precisa
   conhecer esse token — todo dado do Instagram já foi coletado pelo cron
   `lib/cron-insights.ts` e é servido de forma mediada por
   `GET /api/analysis/source`. Se em algum momento a única forma de obter
   um dado for chamando a Graph API diretamente, **não faça isso** — trate
   o dado como indisponível.
4. **Falha na coleta = abortar, nunca inventar.** Se
   `GET /api/analysis/source` falhar (erro de rede, status ≠ 200, 401 por
   token ausente/errado), **pare a execução**, não chame
   `POST /api/analysis`, e reporte o erro exato recebido. Nunca preencha
   `insights`/`recommendations` com dados inventados ou "estimados" para
   compensar uma coleta que falhou.
5. **No máximo 5 recomendações** por relatório (`recommendations.max(5)`
   no schema — ver Passo 3). Priorize as mais acionáveis.
6. **Pelo menos 1 recomendação do tipo `test`** fora do padrão vencedor,
   sempre — regra anti-drift (ver Passo 2, item e).
7. **Ordem de precedência em caso de conflito**: 1) playbook de conteúdo
   (`docs/02-playbook-conteudo.md`) → 2) relatório/dados de
   `GET /api/analysis/source` (fatos observados) → 3) análise deste skill
   (interpretação/recomendação). Este skill nunca é fonte de verdade sobre
   fato — só sobre interpretação de dado já coletado por outra camada.

## Passo 1 — Coletar dados

Todas as chamadas usam `Authorization: Bearer {ANALYSIS_API_TOKEN}` e o
host da rotina, `{APP_URL}` (mesma convenção de
`docs/rotina-geracao.md`).

1. **Obrigatório** — dados da janela de análise:

   ```
   GET {APP_URL}/api/analysis/source?since=8w
   Authorization: Bearer {ANALYSIS_API_TOKEN}
   ```

   Retorna `generatedAt`, `window{since,label}`,
   `pieces[{id,pillar,segment,format,caption,publishAt,igPermalink,metrics,settling}]`,
   `followersTrend[]`, `rankingPilarFormato[]` (já agrupado e ordenado por
   `avgEngagement` — ver `lib/report.ts:buildRanking`) e `totals`. Se essa
   chamada falhar por qualquer motivo, aplique o guard-rail 4 e aborte.

2. **Opcional, recomendado** — relatório anterior, para calcular
   `rawDeltas`:

   ```
   GET {APP_URL}/api/analysis/latest
   Authorization: Bearer {ANALYSIS_API_TOKEN}
   ```

   - `200` → use `report.periodStart/periodEnd/insights` como baseline de
     comparação (ver Passo 2, item c).
   - `404` (`{"error":"no analysis report yet"}`) → é a primeira execução;
     trate `previous = 0` e `deltaPct = null` para todos os `rawDeltas`.
   - Qualquer outro erro (401, 5xx) → **não** aborte a rotina inteira por
     isso (só o Passo 1.1 é obrigatório); trate como se fosse 404
     (primeira execução) e mencione no relatório final que a comparação
     ficou indisponível.

3. **Não disponível para esta rotina** — `GET /api/report/latest` exige
   `GENERATION_API_TOKEN`, que a rotina de análise **não possui** (só
   `ANALYSIS_API_TOKEN`, mais restrito de propósito — ver `lib/auth.ts`).
   Não tente chamar esse endpoint. O ranking equivalente já vem pronto em
   `rankingPilarFormato` da resposta do Passo 1.1 (mesmos números,
   mesma função `buildRanking`) — use-o em vez disso.

## Métricas coletadas (e só elas)

Fonte: `lib/instagram.ts:233-300` (conjuntos de métricas por
`media_product_type`) e `lib/cron-insights.ts` (o que de fato é gravado em
`Piece.metrics` e `AccountSnapshot`).

| Métrica | Formatos que fornecem | Significado | Ressalvas |
|---|---|---|---|
| `reach` | FEED (carrossel, estático), STORY (stories), REELS | Contas únicas alcançadas pela mídia | — |
| `saved` | FEED, REELS | Nº de vezes que a mídia foi salva | Não existe para stories |
| `likes` | FEED, REELS | Curtidas | Não existe para stories |
| `comments` | FEED, REELS | Comentários | Não existe para stories |
| `shares` | FEED, REELS | Compartilhamentos/envios | Não existe para stories |
| `views` | FEED | Visualizações (métrica mais recente da Graph API, pode faltar em mídias antigas) | Campo opcional — nem toda mídia FEED retorna |
| `navigation` | STORY | Interações de navegação (tap-forward/back) agregadas — substituiu as métricas antigas de tap separadas | Só existe enquanto o story está no ar (~24h); depois da janela de insights fechar, o valor congelado é o que ficou salvo em `Piece.metrics` |
| `plays` | REELS | Reproduções do vídeo | Reels ainda não é publicado por este app hoje (ver README) — métrica presente no schema para quando isso mudar; na prática pode não aparecer em nenhuma peça |
| `followersCount` | Conta inteira, não por peça | Snapshot do total de seguidores no momento da coleta (`AccountSnapshot`, exposto em `followersTrend[]`) | É o único dado de nível de conta disponível; nunca é atribuível a uma peça específica |

Engajamento = `likes + comments + saved + shares` (`engagementOf` em
`lib/report.ts`) — **shares e likes não existem para stories**, então
engajamento de stories, quando calculado manualmente, efetivamente vira 0;
prefira `navigation` para julgar desempenho de stories.

**Outras ressalvas:**

- **`settling: true`** (peça publicada há menos de 48h —
  `SETTLING_WINDOW_MS` em `lib/cron-insights.ts`) → métricas ainda não
  estabilizaram. **Excluir sempre** essas peças de médias e rankings
  (Passo 2, item a).
- Métricas de stories só existem dentro da janela de ~24h do story no ar;
  fora dela, o valor gravado é o último capturado antes de expirar (pode
  estar incompleto ou ausente).
- Não existe granularidade por peça para nada de nível de conta — só
  `followersCount` agregado.

**NÃO existe, nunca cite nem infira:** *profile views*, qualquer dado
demográfico da audiência (idade, gênero, localização), "melhor horário
para postar". O Agendaí Social Studio não coleta nada disso hoje — nem
via `lib/instagram.ts`, nem via nenhuma outra rota.

## Passo 2 — Analisar

Com os dados do Passo 1 em mãos:

**(a) Descartar peças em settling.** Filtre `pieces[]` removendo toda
peça com `settling: true` antes de qualquer agregação. Elas continuam
existindo no banco, só não entram em média/ranking desta rodada.

**(b) Montar coortes** (sobre as peças não-settling):

- **Por pilar+formato**: use `rankingPilarFormato` (já vem pronto, mesma
  fórmula de `lib/report.ts`) — não recalcule à mão.
- **Por segmento**: agrupe `pieces[]` por `segment`, calcule `avgReach` e
  engajamento médio (mesma fórmula `engagementOf`) por grupo. Slugs de
  `pillar`/`segment` são `snake_case` — ver tabela em
  `docs/02-playbook-conteudo.md` §2 "Slugs canônicos".
- **Por padrão de hook**: para cada peça, extraia a primeira linha da
  `caption` (até a quebra de linha ou até ~125 caracteres, o que vier
  primeiro) e classifique contra as 8 fórmulas de hook de
  `agendai-social-strategist/SKILL.md` ("Fórmulas de hook": curiosidade,
  dor específica, número/lista, contraste antes/depois, pergunta direta,
  mito vs realidade, bastidor/POV, erro comum). Agrupe por fórmula e
  calcule engajamento médio.

**(c) Calcular `rawDeltas`** (janela atual vs. baseline):

- Se `GET /api/analysis/latest` retornou um relatório anterior (Passo
  1.2), o baseline é a janela `[report.periodStart, report.periodEnd]`
  desse relatório anterior — use os valores de `insights.rawDeltas.*.current`
  dele como o novo `previous`, ou recalcule reach/engagement/followers
  médios das peças daquele período se precisar de granularidade que o
  relatório anterior não guardou.
- Se não houver relatório anterior (404, primeira execução), divida a
  janela atual (`window.since` até `generatedAt`) ao meio por data de
  publicação: metade mais antiga = baseline (`previous`), metade mais
  recente = `current`.
- Métricas de cada `rawDelta`:
  - `reach.current`/`reach.previous` = média de `reach` das peças
    não-settling de cada metade/período.
  - `engagement.current`/`engagement.previous` = média de engajamento
    (`engagementOf`) das peças não-settling de cada metade/período.
  - `followers.current`/`followers.previous` = último `followersCount` de
    `followersTrend[]` na janela atual menos o primeiro da mesma janela
    (net growth), comparado à mesma métrica do período anterior.
- `deltaPct = round(((current - previous) / previous) * 100, 1)`; se
  `previous === 0`, `deltaPct = null` (nunca divida por zero, nunca
  aproxime).

**(d) Evidência mínima:**

- Um combo pilar+formato só pode virar recomendação `promote` ou `avoid`
  se tiver **≥3 peças não-settling** nesse combo. Combos com 1-2 peças
  entram na análise como observação, nunca como recomendação `promote`/
  `avoid`.
- Se o total de peças não-settling na janela inteira for **< 3**, o
  `summaryMarkdown` deve declarar explicitamente "dados insuficientes
  para recomendação por combo" e `recommendations` deve conter **somente**
  itens do tipo `test` (nunca `promote`/`avoid`/`caption`/`image` sem
  evidência suficiente).

**(e) Anti-drift (obrigatório, mesma regra do skill de estratégia):**

- Pelo menos 1 item em `recommendations` deve ser `type: "test"` propondo
  um pilar, formato ou hook **fora** do combo/padrão que mais engajou.
- Nunca recomende reaproveitar um hook (mesma frase de abertura ou
  variação óbvia) usado em qualquer peça publicada nas últimas 6 semanas
  — cheque isso contra as `caption`s de `pieces[]` dentro da janela.

## Passo 3 — Persistir

```
POST {APP_URL}/api/analysis
Authorization: Bearer {ANALYSIS_API_TOKEN}
Content-Type: application/json
```

O corpo é validado por `createAnalysisReportSchema`
(`lib/validation.ts:131-143`). Campos, **exatamente** nesse formato:

| Campo | Tipo/regra |
|---|---|
| `periodStart` | string ISO datetime (`z.string().datetime()`) |
| `periodEnd` | string ISO datetime; deve ser `>= periodStart` (refine do schema) |
| `summaryMarkdown` | string, 1 a 20000 caracteres, markdown em pt-BR |
| `insights.topCombos[]` | `{ pillar: string, format: string, avgEngagement: number, pieces: number }` — pode ser `[]` |
| `insights.hookPatterns[]` | `{ pattern: string, evidence: string }` — pode ser `[]` |
| `insights.captionPatterns[]` | `{ pattern: string, evidence: string }` — pode ser `[]` |
| `insights.formatTactics[]` | `{ format: string, tactic: string, evidence: string }` — pode ser `[]` |
| `insights.imagePromptGuidelines` | `string[]` — pode ser `[]` |
| `insights.rawDeltas.reach` | `{ current: number, previous: number, deltaPct: number \| null }` |
| `insights.rawDeltas.engagement` | mesmo shape de `reach` |
| `insights.rawDeltas.followers` | mesmo shape de `reach` |
| `recommendations[]` | array, **máx. 5**; cada item: `{ type: "promote"\|"avoid"\|"test"\|"caption"\|"image", text: string (não-vazio), evidence: string, priority: 0\|1\|2 }` (`priority`: 2 = alta, 1 = média, 0 = baixa) |
| `schemaVersion` | opcional, literal `1` (default `1` se omitido) |

Todas as chaves de `insights` são obrigatórias (mesmo quando o array
correspondente está vazio) — omitir uma chave falha a validação.

**Exemplo completo de payload** (mês com dados suficientes):

```json
{
  "periodStart": "2026-06-22T00:00:00Z",
  "periodEnd": "2026-08-17T00:00:00Z",
  "summaryMarkdown": "## Revisão mensal — 22/06 a 17/08\n\nJanela de 8 semanas, 9 peças não-settling analisadas. O combo dor→mecânica + carrossel segue liderando engajamento médio (42, 4 peças), com saves puxando a média mais que curtidas — sinal de conteúdo tratado como referência. Stories mantiveram navigation estável, sem sinal de perda de audiência no meio da sequência. Alcance médio caiu 8.3% vs. o período anterior, engajamento subiu 12.5% — hipótese: hooks de pergunta direta estão convertendo melhor em quem já segue, mas testando menos fora da base.\n\nRecomendação de teste obrigatória: variar para o pilar equipe (ainda com poucas peças no período) usando hook de contraste antes/depois, para não saturar 100% em dor→mecânica.",
  "insights": {
    "topCombos": [
      { "pillar": "dor_mecanica", "format": "carrossel", "avgEngagement": 42, "pieces": 4 },
      { "pillar": "objecao_resposta", "format": "estatico", "avgEngagement": 27.5, "pieces": 3 }
    ],
    "hookPatterns": [
      { "pattern": "pergunta_direta", "evidence": "avgEngagement 39, 3 peças (dor_mecanica x2, objecao_resposta x1)" }
    ],
    "captionPatterns": [
      { "pattern": "cta_padrao_sem_qualificacao", "evidence": "9/9 peças usaram o CTA padrão sem variação" }
    ],
    "formatTactics": [
      { "format": "carrossel", "tactic": "manter 6-7 slides com 1 ideia por slide", "evidence": "as 4 peças de carrossel no top combo usaram 6-7 slides" }
    ],
    "imagePromptGuidelines": [
      "Priorizar prints reais de tela (Portal da Equipe, Agenda) sobre fotos genéricas de ambiente — combos com print real tiveram avgEngagement 15% acima da média do período"
    ],
    "rawDeltas": {
      "reach": { "current": 812.4, "previous": 886.1, "deltaPct": -8.3 },
      "engagement": { "current": 34.2, "previous": 30.4, "deltaPct": 12.5 },
      "followers": { "current": 46, "previous": 31, "deltaPct": 48.4 }
    }
  },
  "recommendations": [
    { "type": "promote", "text": "Priorizar carrossel no pilar dor→mecânica na próxima rodada, mantendo 6-7 slides", "evidence": "avgEngagement 42 em dor_mecanica+carrossel, 4 peças não-settling", "priority": 2 },
    { "type": "caption", "text": "Testar hook de pergunta direta como abertura em peças de objeção→resposta", "evidence": "avgEngagement 39 em peças com hook pergunta_direta, 3 peças", "priority": 1 },
    { "type": "image", "text": "Priorizar imagePrompt com print real de tela em vez de foto de ambiente", "evidence": "combos com print real tiveram avgEngagement 15% acima da média do período, observação qualitativa sobre 5 peças", "priority": 1 },
    { "type": "test", "text": "Testar pilar equipe com hook de contraste antes/depois, formato estático, fora do padrão vencedor atual", "evidence": "hipótese — pilar equipe teve só 1 peça no período, dado insuficiente para promover ou evitar", "priority": 1 }
  ]
}
```

**Resposta:**

- `201 { "report": { ...linha criada, incluindo "id" } }` — sucesso.
- `400 { "error": "invalid body", "issues": [...] }` — corpo não bate com
  o schema. Leia `issues`, corrija exatamente o(s) campo(s) apontado(s) e
  tente novamente **uma vez**. Se falhar de novo, aborte e reporte os
  `issues` brutos no relatório final — não force um payload inválido.
- `401 { "error": "unauthorized" }` — token ausente/errado. Aborte
  imediatamente (guard-rail 4); não há retry que resolva isso.

## Passo 4 — Reportar

Ao final da execução, a resposta da rotina deve conter, sem escrever
nenhum arquivo:

- O `id` do `AnalysisReport` criado (ou, se abortado, em qual passo e por
  quê — Passo 1 falhou / `POST /api/analysis` retornou 400 duas vezes /
  401).
- O período analisado (`periodStart`–`periodEnd`) e quantas peças
  entraram na análise vs. quantas foram descartadas por `settling`.
- Os 3 principais achados (ex.: combo vencedor, maior `deltaPct`, padrão
  de hook mais forte).
- A lista de `recommendations` enviada (tipo + texto + prioridade).
- Qualquer coisa pulada ou degradada: `GET /api/analysis/latest`
  indisponível (comparação sem baseline), combos sem evidência suficiente
  para promover/evitar, `since` diferente do default, etc.

## Como a rotina de geração consome

A rotina semanal de geração de conteúdo (`docs/rotina-geracao.md`) lê
`GET /api/analysis/latest` (aceita `ANALYSIS_API_TOKEN` ou
`GENERATION_API_TOKEN`) antes de montar a próxima rodada e usa
`insights`/`recommendations` **apenas como viés** de escolha de
pilar/formato/hook dentro do que a rotação e a regra anti-repetição do
playbook já permitem — nunca como substituto delas (mesma regra de
precedência do guard-rail 7 acima e do skill de estratégia).
