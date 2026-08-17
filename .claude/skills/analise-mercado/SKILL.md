---
name: analise-mercado
description: >-
  Read-only Instagram market-intelligence agent for the Agendaí Social
  Studio, designed to run inside the same monthly analysis routine as
  `/analise-desempenho` and `/agendai-social-strategist`
  (`docs/rotina-analise.md`, zero prior context). Fetches the app-mediated
  competitor/hashtag scan via `GET /api/analysis/market`, researches
  Instagram trends via WebSearch/WebFetch, reads competitor themes and
  hook types (never copying their phrases), and produces up to 5
  `contentProposals` plus `insights.market` for `POST /api/analysis`
  (`schemaVersion: 2`). Never approves or publishes pieces, never holds
  `META_IG_TOKEN`, never scrapes Instagram directly. Trigger phrases:
  "análise de mercado", "pesquisa de concorrentes Instagram", "propostas de
  conteúdo", "tendências de Instagram beleza/bem-estar", "gerar
  contentProposals", "revisão mensal" (parte de mercado).
---

# Análise de mercado — Agendaí Social Studio

Este skill executa a **parte de mercado** da revisão mensal: lê o scan de
concorrentes/hashtags que o app já coletou de forma mediada, complementa com
pesquisa web pública sobre tendências do nicho, e traduz tudo isso em
`insights.market` + até 5 `contentProposals` — candidatos de peça que o
skill `/analise-desempenho` grava junto com o resto do relatório mensal via
`POST /api/analysis` (`schemaVersion: 2`). Ele não escreve `summaryMarkdown`,
`topCombos`, `hookPatterns` de desempenho nem `recommendations` — isso é
escopo de `.claude/skills/analise-desempenho/SKILL.md`. Ele também não
inventa fórmula de hook, estrutura de legenda, CTA ou direção de imagem —
essas regras vêm inteiras de
`.claude/skills/agendai-social-strategist/SKILL.md`, que este skill segue à
risca ao escrever `captionDraft`/`imagePrompt`.

## Quando usar

- Invocado pela rotina cloud mensal (`docs/rotina-analise.md`) **junto com**
  `/agendai-social-strategist` (fórmulas de hook, estrutura de legenda,
  CTA, direção visual) e `/analise-desempenho` (dados de desempenho,
  `topCombos`, `rawDeltas`, `recommendations`). Este skill é dono
  exclusivo da leitura de mercado e de `contentProposals`.
- Sob demanda, se o dono pedir explicitamente pesquisa de mercado ou
  propostas de conteúdo fora do calendário mensal.
- **Não** usar para escrever legenda de uma peça já aprovada nem para
  aprovar/publicar conteúdo — isso é escopo da interface de aprovação.

## Guard-rails e ética

Regras sem exceção, mesmas premissas de `analise-desempenho`:

1. **Somente dados públicos, e só via o app ou a web pública.** Todo dado
   de Instagram vem de `GET /api/analysis/market` (que já medeia Business
   Discovery / hashtag search pelo app) ou de pesquisa web pública
   (`WebSearch`/`WebFetch`). **Nunca** faça scraping direto do Instagram,
   **nunca** faça login ou automatize navegador contra o Instagram, e
   **nunca** tente obter ou usar `META_IG_TOKEN` — se em algum momento a
   única forma de obter um dado for chamar a Graph API diretamente, trate
   o dado como indisponível.
2. **Único call de mercado por execução.** No máximo uma chamada
   `GET /api/analysis/market` por rodada (ver Passo 1). Nunca chame
   repetidamente nem use `?fresh=1` "só para conferir" — a cota de
   hashtags da Meta é de 30 buscas únicas/7 dias por conta, compartilhada
   com qualquer outra execução recente.
3. **Nunca reproduza frase/hook de concorrente, nem de perto.** Ao ler
   `topPosts[].caption` (já sanitizado pelo app), extraia apenas **temas**
   (do que fala) e **tipos de hook** (como abre) — nunca copie, parafraseie
   de perto, nem reaproveite a estrutura literal de uma frase de
   concorrente. As legendas que você escreve são originais, seguindo as
   fórmulas de `agendai-social-strategist`.
4. **`forbiddenClaimHits` são anti-exemplos, nunca inspiração.** Quando um
   post de concorrente tiver `forbiddenClaimHits` não-vazio, isso é uma
   promessa que **o Agendaí não pode fazer** (ex.: resultado garantido, Pix
   no sinal) — nunca proponha algo parecido, mesmo que o post do
   concorrente tenha engajado bem.
5. **Nunca cite concorrente na peça.** Nenhum `captionDraft` ou
   `imagePrompt` deste skill menciona nome de perfil, @, nem número de
   seguidores de concorrente. Concorrentes só aparecem em `rationale` (para
   evidência) e em `insights.market` (dados estruturados) — nunca no texto
   que vai ao ar.
6. **Toda peça respeita o playbook §3 e passa no claim-check.** Todo
   `captionDraft` segue `docs/02-playbook-conteudo.md` §3 (mecânica real,
   plano correto, CTA padrão, 1 emoji, personagens só em Reels) e deve
   passar em `node scripts/claim-check.mjs --text "<captionDraft>"` antes
   de entrar no payload — mesma regra de `agendai-social-strategist`.
7. **Fatos só de `docs/01-produto-referencia.md`.** Nenhum benefício,
   número, plano ou feature entra em `captionDraft`/`imagePrompt` sem
   estar nesse documento.
8. **Somente leitura, exceto a escrita compartilhada.** Este skill nunca
   aprova, edita ou publica peça, nunca faz upload de imagem, nunca chama
   `PATCH /api/pieces/*`, nunca edita o repositório. A única escrita é
   `POST /api/analysis` (feita pelo orquestrador da rotina, ver Passo 5 —
   este skill produz o bloco `insights.market`/`contentProposals` que
   entra nesse payload compartilhado com `analise-desempenho`).
9. **Ordem de precedência em conflito**: 1) playbook de conteúdo → 2) dados
   observados (`/api/analysis/market`, `/api/analysis/source`) → 3) esta
   análise. Este skill nunca é fonte de verdade sobre fato do produto — só
   sobre leitura de mercado.

## Passo 1 — Coletar mercado (app)

Uma única chamada, mesma convenção de host/token de `analise-desempenho`:

```
GET {APP_URL}/api/analysis/market
Authorization: Bearer {ANALYSIS_API_TOKEN}
```

Interprete a resposta (ver `app/api/analysis/market/route.ts` e
`lib/market-scan.ts`):

- **`{empty: true}`** — nenhum competidor/hashtag configurado em
  `/config` → "Inteligência de mercado". Não é erro: siga para o Passo 2
  (pesquisa web) e monte `insights.market` com `competitors: []`,
  `hashtags: []`, preenchendo só `webTrends`. Diga isso explicitamente no
  resumo (Passo 6).
- **`{unavailable: true, reason: "..."}`** — `META_IG_USER_ID`/
  `META_IG_TOKEN` não configurados no app. Mesmo tratamento do `empty`:
  siga com fallback só-web, reporte o motivo exato recebido.
- **200 com dados** — campos `snapshotId`, `createdAt`, `cached` (`true` se
  reaproveitou um `MarketSnapshot` de até 7 dias, sem nova chamada à Graph
  API), `competitors[]`, `hashtags[]`, `errors[]`, e (só quando
  `cached: false`) `quota{uniqueHashtagsLast7d, limit:30, safetyLimit:25}`.
  - `errors[]` (`{item, kind:"competitor"|"hashtag", code?, message}`) —
    falha isolada por item (conta privada, permissão, hashtag não
    encontrada). Nunca aborta o resto do scan; reporte como pré-requisito
    pendente no resumo (ex.: "concorrente X é privado, remover ou trocar em
    /config"), continue com os itens que funcionaram.
  - `hashtags[].skipped === "quota"` — a hashtag não foi consultada por
    estar acima do limite de segurança (25 buscas únicas/7 dias); trate
    como dado ausente para essa hashtag, não como erro.
- **Nunca chame `?fresh=1`** a menos que a própria resposta indique que não
  existe nenhum snapshot ainda (isto é, o único jeito de ter dado é forçar
  uma busca nova) — mesmo assim, é ainda uma única chamada adicional na
  mesma execução, nunca um loop.

## Passo 2 — Pesquisar web (tendências e virais)

Objetivo: contexto de mercado que o scan do app (limitado aos concorrentes/
hashtags configurados) não cobre — tendências gerais do nicho beleza/
bem-estar no Brasil.

Execute 3 a 5 buscas `WebSearch` em pt-BR, por exemplo:

- "tendências Instagram salão de beleza 2026"
- "tendências Instagram barbearia 2026" (ou spa/estética, conforme o
  segmento em foco na rodada)
- "conteúdo viral donos de salão Instagram"
- "reels que mais engajam beleza bem-estar Brasil"
- "dores dono de salão agenda WhatsApp"

Depois, `WebFetch` em 2-3 fontes que pareçam confiáveis (blogs de
marketing/social media reconhecidos, não fóruns anônimos) para extrair
tendência de formato, tema recorrente e dor citada — nunca copie o texto
da fonte, extraia só o *takeaway*.

**`WebFetch` pode estar bloqueado** pelo proxy de egress do ambiente cloud
(`EGRESS_BLOCKED`) — tente no máximo 2 domínios; se bloqueado, use apenas
os resumos do `WebSearch` para os `takeaway`s e registre a degradação no
resumo final (Passo 6) — nunca invente conteúdo de página não lida.

Guarde como `webTrends[{title, url, takeaway}]` — `takeaway` em 1-2 linhas,
sempre reescrito com suas palavras (nunca colado da fonte).

## Passo 3 — Ler concorrentes e virais

Para cada `competitors[]` da resposta do Passo 1:

- Extraia **3-5 temas** (do que as legendas falam: autoestima, promoção,
  bastidor, vitrine de ambiente, educação, etc.) a partir de
  `topPosts[].caption` (já sanitizado/truncado pelo app).
- Classifique o **tipo de hook** dominante de cada `topPosts[]` contra as 8
  fórmulas de `agendai-social-strategist/SKILL.md` ("Fórmulas de hook":
  curiosidade, dor específica, número/lista, contraste antes/depois,
  pergunta direta, mito vs realidade, bastidor/POV, erro comum).
- Note qual **formato** (`mediaType`/`mediaProductType`) concentra mais
  `likeCount + commentsCount` entre os `topPosts`.
- Trate todo `forbiddenClaimHits` não-vazio como anti-exemplo (guard-rail
  4) — nunca como sinal de "isso funciona, replicar".

Para cada `hashtags[]` (ignorando `skipped: "quota"`): mesmos temas +
`samplePermalinks` (os `permalink` dos `topPosts`, para citar como
evidência em `sources`).

Ao final da leitura, identifique explicitamente:

- O **padrão dominante do mercado** (ex.: "maioria posta vitrine de
  ambiente com legenda genérica de autoestima, sem mostrar mecânica de
  agendamento").
- Pelo menos um **gap** que os concorrentes não cobrem e que a mecânica
  real do Agendaí cobre (`docs/01-produto-referencia.md`) — esse gap
  alimenta a proposta "fora do padrão" do Passo 4.

## Passo 4 — Propostas de conteúdo (3–5)

Monte de 3 a 5 `contentProposals`, cada um com exatamente estes campos
(nomes/tipos idênticos a `contentProposalSchema` em `lib/validation.ts`):

| Campo | Tipo/regra |
|---|---|
| `pillar` | string não-vazio — um dos 6 pilares do playbook §2, slug `snake_case` já usado no código (`dor_mecanica`, `tela_real_bastidores`, `educacao_gestao`, `objecao_resposta`, `cliente_final`, `equipe`) |
| `segment` | string não-vazio — um dos 5 segmentos do playbook §2, mesmo slug `snake_case` (`salao_barbearia`, `spa_massoterapia`, `studio_unha_cilio_sobrancelha`, `clinica_estetica`, `multi_unidade`) |
| `format` | `"carrossel" \| "reels" \| "estatico" \| "stories"` (`PIECE_FORMATS`) |
| `hook` | string não-vazia — 1ª linha original, ≤125 caracteres visíveis, uma das 8 fórmulas de `agendai-social-strategist` |
| `captionDraft` | string não-vazia, **máx. 2200 caracteres** — hook → desenvolvimento → mecânica real (`docs/01-produto-referencia.md`) → CTA padrão `agendai.space — 30 dias grátis, sem cartão` → 5-8 hashtags. Máx. 1 emoji. **Deve passar** `node scripts/claim-check.mjs --text "<captionDraft>"` |
| `imagePrompt` | string não-vazia — direção visual completa (estilo sage/off-white, proporção, overlay exato, print real se citável), seguindo `agendai-social-strategist` §"Direção de imagePrompt" e §"Táticas por formato" |
| `rationale` | string — por que essa proposta: evidência concreta (permalink/URL/tema) + qual gap/tendência ela explora |
| `sources` | `string[]` — permalinks de `topPosts`/`samplePermalinks` e/ou URLs de `webTrends` usados como evidência |

Regras da lista completa (não por item):

- `pillar`/`segment` são strings livres no schema (não enum), mas **use
  exatamente os slugs de `docs/02-playbook-conteudo.md` §2 "Slugs
  canônicos"** — os mesmos que aparecem em `GET /api/pieces?since=6w` —
  para o campo permanecer consultável junto com
  `topCombos`/`rankingPilarFormato`.
- **Pelo menos 1 proposta deliberadamente fora do padrão dominante dos
  concorrentes** (anti-drift/diferenciação — ver o gap identificado no
  Passo 3).
- **Pelo menos 1 proposta ancorada numa tendência web** do Passo 2 (cite a
  URL em `sources`).
- Propostas são **candidatas**, nunca peças finais — a rotina de geração
  (`docs/rotina-geracao.md`) ainda aplica rotação e a regra
  anti-repetição do playbook §2, e usa **no máximo 1 proposta por
  rodada**. Não force volume: 3 propostas sólidas valem mais que 5 fracas.
- **Nunca reaproveite um hook** já usado em `GET /api/pieces?since=6w`
  (endpoint público, sem token — ver `app/api/pieces/route.ts`) — mesma
  frase de abertura ou variação óbvia. Consulte esse endpoint antes de
  fechar a lista de propostas.
- Toda proposta segue as regras duras de `agendai-social-strategist`
  (fatos só de `01-produto-referencia.md`, plano correto quando gated,
  personagens LARA/CAMILA/JÚLIA só em Reels com descrição verbatim de
  §8, hashtags 5-8, máx. 1 emoji).

## Passo 5 — Montar o payload v2

Este skill não chama `POST /api/analysis` sozinho — ele entrega
`insights.market` e `contentProposals[]` para o orquestrador da rotina
(que também roda `analise-desempenho`) incluir no **mesmo** corpo, com
`schemaVersion: 2`. Campos, validados por `createAnalysisReportSchema`
(`lib/validation.ts`):

```
insights.market {
  competitors: [{ username, followers, avgLikes, avgComments, themes[], topPosts: [{ permalink, likes, comments, hookType }] }],
  hashtags: [{ tag, themes[], samplePermalinks[] }],
  webTrends: [{ title, url, takeaway }],
}
contentProposals: [ { pillar, segment, format, hook, captionDraft, imagePrompt, rationale, sources[] }, ... ]  // máx. 5
```

**Atenção aos nomes de campo — diferem do endpoint de scan**
(`GET /api/analysis/market`) porque o payload de persistência usa nomes
mais curtos/genéricos que o schema de validação já fixou:

| No scan (`market-scan.ts`) | No payload v2 (`analysisMarketSchema`) |
|---|---|
| `followersCount` | `followers` |
| `likeCount` | `likes` |
| `commentsCount` | `comments` |
| `mediaType`/`mediaProductType` | (não entra — vira `hookType`, sua classificação) |
| `caption`/`forbiddenClaimHits` | (não entram — só alimentam `themes`/`hookType` e o guard-rail 4) |

`insights.market` é **opcional** no schema (`z.object({...}).optional()`) —
se a coleta do Passo 1 for `empty`/`unavailable`, ainda assim preencha
`insights.market` com `competitors: []`, `hashtags: []` e o `webTrends` do
Passo 2 (nunca omita a chave inteira se você rodou o Passo 2 com sucesso),
e declare no `summaryMarkdown` que o scan de concorrentes ficou
indisponível nesta janela.

`contentProposals` é validado com `.max(5)`, igual `recommendations`.
`schemaVersion` deve ser `2` (literal `1 | 2`, default `1` se omitido —
**sempre declare `2` explicitamente** quando este skill contribuiu com o
payload).

**Resposta de `POST /api/analysis`** (mesmo endpoint de `analise-desempenho`,
ver `app/api/analysis/route.ts`):

- `201` — sucesso, `report.id`.
- `400` — corpo não bate com `createAnalysisReportSchema`; `issues[]` aponta
  o campo. Corrija e tente **uma vez**.
- `422 { "error": "captionDraft violates forbidden claims", "proposalIndex": N, "violations": [...] }`
  — o `captionDraft` do `contentProposals[N]` falhou o claim-check no
  servidor (mesma checagem de `checkText`). Reescreva **só essa proposta**
  usando o `substitute` da regra violada (mesma lógica de
  `docs/promessas-proibidas.json`), tente novamente **uma vez**. Se falhar
  de novo, remova essa proposta do payload e relate o bloqueio no resumo —
  **nunca** force o payload a passar sem corrigir a violação real.
- `401` — token ausente/errado; aborte, sem retry.

## Passo 6 — Reportar

Ao final, o que este skill contribui para o resumo da rotina (junto com o
que `analise-desempenho` já reporta):

- Status do scan de mercado: `cached`/fresh, `empty`/`unavailable` (com
  motivo), `quota.uniqueHashtagsLast7d` se disponível, e cada item de
  `errors[]` como pré-requisito pendente.
- Os 3 principais temas encontrados em concorrentes/hashtags e o padrão
  dominante identificado (Passo 3).
- O gap de mercado encontrado e qual proposta o explora.
- A lista de `contentProposals` enviada — 1 linha cada
  (pilar+segmento+formato+hook resumido).
- Qual proposta é a "fora do padrão" (anti-drift) e qual é a ancorada em
  tendência web, explicitamente marcadas.
- Qualquer proposta descartada por falha repetida no claim-check (422) e
  por quê.

## Exemplo

`insights.market` e 2 `contentProposals` (1 carrossel dentro do gap de
mercado, 1 reels ancorado em tendência web) — payload completo validado
com `createAnalysisReportSchema` via `node --experimental-strip-types`
importando `lib/validation.ts` diretamente:

```json
{
  "insights": {
    "market": {
      "competitors": [
        {
          "username": "salaobelavistaoficial",
          "followers": 18400,
          "avgLikes": 210,
          "avgComments": 12,
          "themes": ["vitrine de ambiente", "autoestima genérica", "promoção de pacote"],
          "topPosts": [
            { "permalink": "https://www.instagram.com/p/EXEMPLO1/", "likes": 540, "comments": 30, "hookType": "contraste_antes_depois" }
          ]
        }
      ],
      "hashtags": [
        {
          "tag": "salaodebeleza",
          "themes": ["antes/depois de procedimento", "vitrine de ambiente"],
          "samplePermalinks": ["https://www.instagram.com/p/EXEMPLO2/"]
        }
      ],
      "webTrends": [
        {
          "title": "Reels de bastidor \"um dia no salão\" em alta no nicho beleza/bem-estar",
          "url": "https://example.com/tendencias-instagram-beleza-2026",
          "takeaway": "Vídeos curtos mostrando o dia a dia real do profissional (não só o resultado) engajam mais que fotos estáticas de ambiente."
        }
      ]
    }
  },
  "contentProposals": [
    {
      "pillar": "dor_mecanica",
      "segment": "salao_barbearia",
      "format": "carrossel",
      "hook": "Toda concorrente na sua região posta foto de salão bonito. Quase nenhuma mostra como a cliente marca sozinha.",
      "captionDraft": "Toda concorrente na sua região posta foto de salão bonito. Quase nenhuma mostra como a cliente marca sozinha.\n\nEnquanto o feed vira vitrine, a dor continua a mesma: mensagem de sexta às 17h perguntando se ainda tem horário.\n\nCom o link público do Agendaí, a cliente vê os horários livres e marca direto, sem esperar sua resposta. Se o serviço pede sinal, ela paga na hora pelo cartão, via Stripe — o valor cai na sua conta, sem comissão do Agendaí.\n\nagendai.space — 30 dias grátis, sem cartão.\n\n#agendaí #salãodebeleza #barbearia #gestãodenegócio #agendamentoonline #donadenegócio",
      "imagePrompt": "Print real da tela do link público de agendamento sobreposto a uma foto real de recepção de salão, luz natural, tom sage green/off-white. Proporção 1:1. Sem overlay de texto — a legenda carrega o gancho.",
      "rationale": "Explora a lacuna do padrão dominante dos concorrentes (vitrine de ambiente, nunca mecânica de agendamento) — ver competitor salaobelavistaoficial, tema 'vitrine de ambiente' em todos os topPosts.",
      "sources": ["https://www.instagram.com/p/EXEMPLO1/"]
    },
    {
      "pillar": "cliente_final",
      "segment": "studio_unha_cilio_sobrancelha",
      "format": "reels",
      "hook": "POV: a cliente marca o horário sozinha, sem trocar nenhuma mensagem.",
      "captionDraft": "POV: a cliente marca o horário sozinha, sem trocar nenhuma mensagem.\n\nEla abre o link do Agendaí, escolhe o serviço e o horário livre, paga o sinal na hora pelo cartão — e pronto, já tá na agenda.\n\nagendai.space — 30 dias grátis, sem cartão.\n\n#agendaí #estúdiodeunhas #cíliosesobrancelhas #atendimentosozinha #agendamentoonline #gestãodenegócio",
      "imagePrompt": "Reel vertical 9:16, 4 cenas ~20-30s, prompt de geração em inglês, diálogo em PT-BR. Personagem LARA (massoterapeuta dona de estúdio, brasileira, 35 anos, cabelo cacheado escuro preso, polo verde sage) mostrando o celular com a tela do link público enquanto a cliente CAMILA (cliente fiel, brasileira, 40 anos, cabelo castanho liso, blusa de linho) marca sozinha o horário. Card final: agendai.space + '30 dias grátis'.",
      "rationale": "Grounded no webTrend 'reels de bastidor em alta no nicho beleza/bem-estar 2026' — formato fora do padrão de carrossel/estático dominante nas peças recentes, ângulo do cliente final em vez de dono.",
      "sources": ["https://example.com/tendencias-instagram-beleza-2026"]
    }
  ]
}
```

**Claim-check dos dois `captionDraft` acima** (executado localmente antes
de propor o exemplo):

```
$ node scripts/claim-check.mjs --text "Toda concorrente na sua região posta..."
{"ok":true,"violations":[]}

$ node scripts/claim-check.mjs --text "POV: a cliente marca o horário sozinha..."
{"ok":true,"violations":[]}
```

**Validação do payload v2 completo** (este `insights.market` +
`contentProposals` combinados com um `summaryMarkdown`/`recommendations`
de exemplo de `analise-desempenho`, contra `createAnalysisReportSchema`):

```
$ node --experimental-strip-types validate-payload.ts
SUCCESS
{
  "ok": true,
  "schemaVersion": 2
}
```
