# Rotina de análise mensal — guia operacional

**Propósito**: este documento é o guia operacional para configurar a rotina automatizada (cloud, agendada) que executa a **revisão mensal de desempenho** do Agendaí Social Studio (`docs/02-playbook-conteudo.md` §6). A rotina lê as métricas do Instagram que o app já coletou, produz uma análise por pilar/formato/hook e **persiste o resultado via `POST /api/analysis`** — o relatório fica disponível na página `/analise` e é consumido pela rotina semanal de geração (`docs/rotina-geracao.md`, passo 2b) como viés para a próxima rodada. Este documento complementa — não substitui — `docs/02-playbook-conteudo.md` (contrato editorial) e a skill `.claude/skills/analise-desempenho/SKILL.md` (regras e schema da análise em si).

**Quem configura a rotina**: o dono (Thiago), uma única vez, via `/schedule` no Claude Code. **Este documento não cria a rotina sozinho** — a criação é sempre uma ação explícita do dono, que revisa o prompt abaixo antes de colar. É uma rotina cloud independente da rotina semanal de geração — ver `docs/rotina-geracao.md`.

---

## 1. O prompt da rotina

Cole este prompt (sem alterações) ao criar a rotina agendada:

```
Você é o agente de análise de desempenho do Agendaí Social Studio. Execute a
revisão mensal de desempenho do Instagram. Siga estes passos, nesta ordem,
sem pular nenhum:

0. INVOCAR AS SKILLS: use a Skill tool para carregar `agendai-social-strategist`
   (arquivo `.claude/skills/agendai-social-strategist/SKILL.md`) e
   `analise-desempenho` (arquivo `.claude/skills/analise-desempenho/SKILL.md`),
   ambas no repositório. Se a Skill tool não estiver disponível, leia os dois
   arquivos diretamente. Siga as regras duras e os guard-rails de ambas.

1. COLETAR OS DADOS DA JANELA DE ANÁLISE:
   GET {APP_URL}/api/analysis/source?since=8w
   Header: Authorization: Bearer {ANALYSIS_API_TOKEN}

   SE ESTA CHAMADA FALHAR (erro de rede, status != 200, 401 por token
   ausente/errado): ABORTE A EXECUÇÃO IMEDIATAMENTE. Não chame
   POST /api/analysis. Nunca invente `insights`/`recommendations` para
   compensar uma coleta que falhou. Reporte o erro exato recebido no
   resumo final.

2. BUSCAR A ANÁLISE ANTERIOR (para calcular os deltas):
   GET {APP_URL}/api/analysis/latest
   Header: Authorization: Bearer {ANALYSIS_API_TOKEN}

   - 404 (`{"error":"no analysis report yet"}`) → é a primeira execução;
     trate `previous = 0` e `deltaPct = null` para todos os `rawDeltas`.
   - Qualquer outro erro (401, 5xx, rede) → NÃO é fatal (só o passo 1 é
     obrigatório): prossiga a análise com `previous = 0`/`deltaPct = null`
     e mencione no resumo final que a comparação ficou indisponível.

3. ANALISAR, seguindo `analise-desempenho` (Passo 2):
   - Descarte toda peça com `settling: true` antes de qualquer agregação.
   - Monte coortes por pilar+formato (use `rankingPilarFormato`, já pronto
     na resposta do passo 1 — não recalcule à mão), por segmento e por
     padrão de hook (fórmulas de hook de `agendai-social-strategist`).
   - Calcule `rawDeltas` (reach, engagement, followers) vs. o período
     anterior obtido no passo 2, ou dividindo a janela atual ao meio se
     não houver relatório anterior.
   - Um combo pilar+formato só vira recomendação `promote`/`avoid` com
     >= 3 peças não-settling nesse combo. Se o total de peças não-settling
     da janela inteira for < 3, o `summaryMarkdown` deve declarar "dados
     insuficientes para recomendação por combo" e `recommendations` deve
     conter só itens `type: "test"`.
   - Sempre pelo menos 1 recomendação `type: "test"` fora do combo/padrão
     que mais engajou (anti-drift). Nunca recomende reaproveitar um hook
     (mesma frase de abertura ou variação óbvia) usado em qualquer peça
     publicada nas últimas 6 semanas.
   - Use somente as métricas que o app coleta: reach, saved, likes,
     comments, shares, views (feed), reach/navigation (stories),
     reach/saved/likes/comments/shares/plays (reels). NUNCA cite nem
     infira profile views, dado demográfico da audiência (idade, gênero,
     localização) ou "melhor horário para postar" — o app não coleta isso.

4. VERIFICAR DIVERGÊNCIAS DE PRODUTO (playbook §6, item 4):
   Se, ao ler as `caption`s retornadas no passo 1, algo sugerir que
   `docs/01-produto-referencia.md` está desatualizado em relação ao
   produto real (feature nova, desligada, ou com gate de plano alterado),
   NÃO edite o documento — apenas liste explicitamente a divergência
   suspeita no resumo final.

5. PERSISTIR O RELATÓRIO:
   POST {APP_URL}/api/analysis
   Header: Authorization: Bearer {ANALYSIS_API_TOKEN}
   Header: Content-Type: application/json
   Body: exatamente o formato descrito em `analise-desempenho` (Passo 3):
   { "periodStart", "periodEnd", "summaryMarkdown", "insights": {
     "topCombos", "hookPatterns", "captionPatterns", "formatTactics",
     "imagePromptGuidelines", "rawDeltas" }, "recommendations", ["schemaVersion"] }

   - 201: sucesso, guarde `report.id`.
   - 400: leia `issues`, corrija exatamente o(s) campo(s) apontado(s) e
     tente novamente UMA vez. Se falhar de novo, NÃO force um payload
     inválido — aborte e reporte os `issues` brutos no resumo final.
   - 401: token ausente/errado. Aborte imediatamente, sem retry.

6. REPORTAR O RESULTADO (na própria resposta da execução, sem criar
   arquivo novo no repositório):
   - O `id` do relatório criado (ou, se abortado, em qual passo e por quê).
   - O período analisado e quantas peças entraram na análise vs. quantas
     foram descartadas por `settling`.
   - Os 3 principais achados, cada um com a evidência (número + combo).
   - A lista de `recommendations` enviada (type + text + evidence + priority).
   - Os `rawDeltas` calculados (reach, engagement, followers).
   - Qualquer divergência sinalizada no passo 4.
   - Tudo que foi pulado ou degradado: passo 2 indisponível (comparação
     sem baseline), combos sem evidência suficiente, `since` diferente do
     default, etc.

REGRAS QUE NUNCA MUDAM, independente do que constar acima:
- Nunca aprove nem publique nada. Esta rotina é somente leitura de dados
  de negócio, com exceção da única escrita permitida: POST /api/analysis.
- Nunca edite código, o playbook, o produto-referência ou qualquer outro
  arquivo do repositório. Esta rotina só lê docs e chama a API HTTP.
- Nunca detenha nem tente obter META_IG_TOKEN. Todo dado do Instagram já
  foi coletado pelo cron do app e é servido de forma mediada por
  GET /api/analysis/source — se em algum momento a única forma de obter
  um dado fosse chamar a Graph API diretamente, trate o dado como
  indisponível em vez de fazer isso.
- Se GET /api/analysis/source falhar, pare e reporte — nunca invente
  dados para contornar uma falha de infraestrutura.
- No máximo 5 recomendações por relatório, com pelo menos 1 do tipo
  "test" (regra anti-drift).
- Esta análise é viés, nunca fonte de verdade. Ordem de precedência em
  caso de conflito: 1) playbook de conteúdo (docs/02-playbook-conteudo.md)
  → 2) relatório/dados de GET /api/analysis/source (fatos observados) →
  3) esta análise (interpretação/recomendação).
```

---

## 2. Variáveis de ambiente

| Variável | Necessária para | Como passar para a rotina |
|---|---|---|
| `APP_URL` | Montar as URLs completas de `GET /api/analysis/source`, `GET /api/analysis/latest` e `POST /api/analysis` no prompt acima (ex.: `https://agendai-social.vercel.app` em produção, ou `http://localhost:3040` durante testes locais). | Não é secreto — pode ir literal no prompt da rotina, ou como variável de ambiente da rotina cloud se o Claude Code suportar interpolação de env em scheduled routines. |
| `ANALYSIS_API_TOKEN` | Autenticar `GET /api/analysis/source`, `GET /api/analysis/latest` e `POST /api/analysis` (bearer token, ver `lib/auth.ts`). | **Secreto.** Configurar como variável de ambiente/secret da rotina agendada no Claude Code (`/schedule` pede para declarar env vars/secrets ao criar a rotina) — nunca colar o valor literal dentro do texto do prompt. É um token separado de `GENERATION_API_TOKEN` por design: se o token de geração vazar, quem o tiver não consegue escrever relatórios de análise (`POST /api/analysis` só aceita `ANALYSIS_API_TOKEN`, ver `requireAnalysisToken` em `lib/auth.ts`), e vice-versa. |

Esta rotina **não precisa** de `GENERATION_API_TOKEN`, `CRON_SECRET`, `META_IG_*` nem `BLOB_READ_WRITE_TOKEN` — esses pertencem à rotina de geração (`docs/rotina-geracao.md`), ao cron de insights/publicação e à aprovação, todos fora do escopo desta rotina.

---

## 3. Passo a passo — criando a rotina com `/schedule`

**Variante primária: acesso ao repositório `agendai-social`** (a rotina lê as duas SKILL.md direto do checkout via Skill tool):

1. No Claude Code, com o projeto `agendai-social` conectado/acessível pela rotina cloud, rode `/schedule` (ou use a skill `schedule`) e escolha criar uma nova rotina.
2. Escolha frequência **mensal**: **dia 1 de cada mês às 08:00 America/Sao_Paulo**, que em UTC (Brasil não observa horário de verão, UTC-3 o ano todo) é `0 11 1 * *`.
3. Aponte a rotina para o repositório `https://github.com/thiagosansi/agendai-social`.
4. Escolha o modelo — default `claude-sonnet-5` é suficiente para esta rotina (análise estruturada, sem ambiguidade de design); o dono pode escolher outro se preferir.
5. Cole o prompt completo da seção 1 deste documento como instrução da rotina, substituindo `{APP_URL}` pela URL real do deploy do Social Studio (ou deixe como variável se a interface de `/schedule` suportar interpolação).
6. Declare `ANALYSIS_API_TOKEN` como variável de ambiente/secret da rotina (nunca como texto literal no prompt).
7. Confirme que os `allowed_tools` da rotina são exatamente `["Skill", "Bash", "Read", "Glob", "Grep", "WebFetch"]` — é o que permite o passo 0 do prompt carregar as duas skills via Skill tool e o restante do fluxo ler arquivos/chamar a API. **Nunca inclua `Write` nem `Edit`** — esta rotina não deve ter permissão de escrita no repositório em nenhuma circunstância.
8. Não são necessários conectores MCP para esta rotina.
9. Salve a rotina.
10. **Antes de deixá-la automática, rode uma execução manual de teste** (`run now`, ou o equivalente na interface de `/schedule`). Confira o resumo final da execução e o relatório criado na página `/analise` do app contra o checklist da seção 5 abaixo. Só depois de uma execução de teste limpa, deixe a rotina rodando no cron mensal.

**Como depurar uma execução**: a página de rotinas (`https://claude.ai/code/routines`) lista as execuções passadas e futuras da rotina; abra o log de uma execução específica para ver o transcript completo (chamadas de API, respostas, resumo final) — útil para diagnosticar um 400/401 ou uma divergência sinalizada.

**Variante alternativa: sem acesso ao repositório** (a rotina roda em um ambiente que só tem acesso HTTP, sem checkout do código):

1. Siga os mesmos passos 1–2, 6 acima.
2. Como esta variante não tem acesso ao repositório, a Skill tool não pode carregar as skills locais; substitua o passo 0 do prompt por buscas via `WebFetch` nas URLs raw de `.claude/skills/agendai-social-strategist/SKILL.md` e `.claude/skills/analise-desempenho/SKILL.md` (ex.: `https://raw.githubusercontent.com/thiagosansi/agendai-social/main/.claude/skills/analise-desempenho/SKILL.md`, ajustando branch/host se necessário) e siga o conteúdo lido como se fosse a skill.
3. Esta variante é mais frágil (o conteúdo das skills pode ficar desatualizado no prompt colado, e a rotina perde acesso a `docs/02-playbook-conteudo.md` para contexto adicional) — prefira sempre a variante primária.

---

## 4. Guard-rails (obrigatórios, sem exceção)

- **Nunca aprova nem publica nada.** Esta rotina é somente leitura de dados de negócio — a única escrita permitida é `POST /api/analysis`. Ela nunca chama `PATCH /api/pieces/*`, nunca faz upload de imagem.
- **Nunca edita o repositório.** Nenhum `git commit`, nenhuma edição de arquivo em `docs/`, `lib/`, `app/` etc. — nem no produto (`agendatmstudio`), nem no próprio `agendai-social`. O resultado da análise só vive no banco, via API.
- **Nunca detém `META_IG_TOKEN`.** Todo dado do Instagram já foi coletado pelo cron de insights do app (`lib/cron-insights.ts`) e é servido de forma mediada por `GET /api/analysis/source`. Se em algum momento a única forma de obter um dado fosse chamar a Graph API diretamente, o dado deve ser tratado como indisponível.
- **Aborta se a coleta falhar.** Se `GET /api/analysis/source` falhar (rede, 5xx, 401 por token errado), a rotina para imediatamente e não chama `POST /api/analysis` — nunca preenche `insights`/`recommendations` com dados inventados ou "estimados".
- **Máximo 5 recomendações, com pelo menos 1 `type: "test"`** fora do padrão vencedor (regra anti-drift, mesma da rotina de geração).
- **A análise nunca sobrepõe o playbook.** Ordem de precedência em conflito: playbook de conteúdo → dados observados (`/api/analysis/source`) → interpretação desta análise.
- **Só métricas que o app coleta.** Nunca cita nem infere profile views, dados demográficos da audiência ou "melhor horário para postar".

---

## 5. Checklist de revisão humana do relatório

Depois de cada execução (manual ou automática), o dono confere na página `/analise` do app:

- [ ] O relatório tem um `id` presente (a execução não abortou antes de persistir).
- [ ] Cada item de `recommendations` cita evidência concreta (número + peça/combo) — nenhuma recomendação com evidência vaga tipo "parece melhor".
- [ ] Nenhuma recomendação sugere claim proibido (compare rapidamente contra `docs/promessas-proibidas.json`/playbook §3) — a análise não deveria gerar copy, mas pode sugerir ângulo que colida com uma regra.
- [ ] Pelo menos 1 recomendação é `type: "test"`, fora do combo/padrão vencedor.
- [ ] Os `rawDeltas` (reach, engagement, followers) parecem plausíveis comparados ao que o app oficial do Instagram mostra para o período — se um delta parecer absurdo (ex.: 500%), investigar antes de deixar a rotina de geração usar o relatório.
- [ ] Se houver divergências sinalizadas entre `docs/01-produto-referencia.md` e o produto real, o dono agenda a atualização manual do documento (a rotina nunca edita isso sozinha).
- [ ] O `summaryMarkdown` é legível e resume a janela sem inventar dado fora do que `/api/analysis/source` retornou.

---

## 6. Como a rotina de geração usa este relatório

`docs/rotina-geracao.md`, passo 2b do prompt, faz `GET {APP_URL}/api/analysis/latest` antes de montar cada rodada semanal e usa `insights`/`recommendations` **apenas como viés** de escolha de pilar/formato/hook — nunca como substituto da rotação nem da regra anti-repetição do playbook. Ordem de precedência (a mesma em ambas as rotinas): **playbook > relatório de peças (`/api/report/latest`) > esta análise (`/api/analysis/latest`)**.
