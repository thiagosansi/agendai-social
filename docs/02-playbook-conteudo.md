# Playbook de conteúdo — Instagram Agendaí

**Última atualização**: 2026-08-16 (adaptado para o Social Studio — fluxo via API + aprovação web + publicação automática)
**Quem executa a geração**: um agente de IA (rotina cloud do Claude Code, Claude Cowork em tarefa agendada, ou qualquer chamada autenticada ao endpoint de geração) — ver seção 7.
**Quem aprova**: o fundador (Thiago), humano, na interface web de aprovação do Social Studio. Cada peça nasce com status `draft` e só é publicada depois que o dono a aprova — o que inclui gerar/escolher a imagem a partir do `imagePrompt` da peça e fazer upload dela na interface.
**Quem publica**: um cron diário do Social Studio, que consulta as peças com status `approved` e publica via Instagram Graph API. **A publicação deixa de ser manual**, mas a aprovação humana continua obrigatória e é o único portão de qualidade antes de qualquer peça ir ao ar — nada é publicado sem um humano ter revisado o texto e carregado a imagem.

**Propósito**: este documento é o contrato operacional que o agente segue, sem perguntar, a cada rodada de geração de conteúdo. Se o agente estiver em dúvida sobre o que fazer numa rodada, a resposta está aqui — não invente processo novo.

**Ciclo de vida de uma peça**: `draft → approved → published` (ou `failed`, se a publicação via Graph API falhar). Tudo fica no banco de dados (tabela `Piece`, modelo adicionado em uma task posterior a este documento), não em arquivos Markdown no repositório.

**Documentos ligados**:
- `docs/01-produto-referencia.md` — fonte factual única (features, planos, tom, personagens). Este playbook NUNCA duplica esse conteúdo, só referencia.
- `docs/promessas-proibidas.json` — lista machine-readable de promessas banidas, consumida por `scripts/claim-check.mjs` e pelo endpoint de criação de peça (que roda a mesma checagem no servidor antes de gravar o `draft`).
- API de peças (`POST /api/pieces`, etc.) e interface de aprovação web — implementadas em tasks posteriores. Este playbook descreve o contrato de conteúdo que essas peças devem seguir; a forma exata do payload/endpoint está documentada junto ao código quando existir.

---

## 1. Inputs de cada rodada

Leia **nesta ordem**, sempre, antes de gerar qualquer peça:

1. `docs/01-produto-referencia.md` — inteiro. É a única fonte de verdade sobre o que o produto faz, para quem, em qual plano.
2. `docs/promessas-proibidas.json` — para saber o que não pode aparecer em copy nenhuma.
3. **Peças já criadas nas últimas 6 semanas ISO** — consulte via API (`GET /api/pieces?since=<data>` ou equivalente, qualquer status). Não repita a combinação pilar + segmento + formato já usada nesse período (regra completa na seção 2).
4. **Estrutura de uma peça** — toda peça é criada via `POST /api/pieces` com status inicial `draft`, preenchendo os campos do modelo `Piece`: pilar, segmento, formato, legenda, hashtags e `imagePrompt` (descrição da imagem/cena desejada). Nunca escreva a peça fora desse contrato de campos.
5. **Imagem da peça**: o agente **não gera nem sobe imagem nem vídeo**. Ele escreve um `imagePrompt` claro o suficiente para o dono gerar ou escolher a mídia certa na hora de aprovar (ex.: "print real da tela de Agenda do Portal da Equipe" ou "foto do balcão de recepção do salão"). Se o agente tiver acesso a screenshots reais do produto (por exemplo, ao rodar dentro do checkout do repositório principal `agendatmstudio`, pasta `Imagens/`), pode citar o print exato no `imagePrompt`; caso não tenha esse acesso, descreva a cena com detalhe suficiente para o dono saber o que produzir. Para `reels`, o `imagePrompt` é na verdade um **briefing/roteiro de vídeo** (cena a cena, texto na tela quando houver, duração alvo ≤ 60–90s, personagem LARA/CAMILA/JÚLIA quando aplicável, formato 9:16) — o dono grava/edita o MP4 e faz o upload direto na UI (`/fila`) na hora de aprovar, não um `imagePrompt` de imagem estática.
6. **Divergência de código**: se o agente tiver acesso ao repositório do produto (`agendatmstudio`), rode `git log --oneline --since="2 weeks ago" -- lib/plan-guard.ts prisma/schema.prisma`. Se houver commits recentes, **não** assuma que `01-produto-referencia.md` já reflete a mudança — registre a suspeita de divergência nas notas internas da peça (campo de notas/observações do payload da API) em vez de inventar comportamento novo ou tentar reconferir o código sozinho além do necessário.

Se qualquer um desses inputs estiver ausente ou inacessível na hora da execução (arquivo de docs ausente, API fora do ar), pare a rodada, reporte o motivo na resposta da execução e não gere peças com dados inventados.

---

## 2. Cadência e rotação

- **Cadência default**: 1 rodada por semana, gerando **2 peças** por rodada. Parâmetro `PECAS_POR_RODADA` (default `2`) — o dono pode pedir para subir até `4` numa rodada específica, indicando isso no prompt daquela execução (ver seção 7).
- **Rotação de formato em ciclo de 2 semanas** (cobre os 4 formatos a cada 2 semanas):
  - **Semana A** (semana ISO ímpar dentro do ciclo do produto): carrossel + stories.
  - **Semana B**: reels IA + estático.
  - Se `PECAS_POR_RODADA` for maior que 2, complete o par da outra semana adiantado, mas nunca gere 2 peças do mesmo formato na mesma rodada sem necessidade clara (registrar por quê nas notas da peça).

### Pilares de conteúdo (rotação, 6 pilares)

| Pilar | O que é | Exemplo concreto (fonte: 01) |
|---|---|---|
| (a) Dor → mecânica | Dor real do dono/cliente resolvida por uma mecânica específica do produto | "Cliente marca domingo às 23h" → link público de agendamento (`01 §3`, Agendamento público) |
| (b) Tela real / bastidores do produto | Mostra a UI de verdade em uso, com print real (via `imagePrompt`) | Tela do Portal da Equipe mostrando a agenda do dia |
| (c) Educação de gestão | Ensina uma prática de gestão que o produto viabiliza | Como definir política de cancelamento visível; quando exigir sinal (`requiresDeposit`); como montar pacote de sessões |
| (d) Objeção → resposta | Responde objeção real levantada no outreach | "Trabalho sozinha" / "minhas clientes são fixas" / "elas gostam do WhatsApp" (fonte: `docs/outreach-whatsapp.md` do repositório principal) |
| (e) Cliente final | O que muda para quem agenda, não para o dono | Área do cliente sem senha (`/agendar/[slug]/conta/[token]`); política de cancelamento visível antes de confirmar; "coberto pelo seu pacote" |
| (f) Equipe | Gestão de equipe e comissão | Portal por PIN (`lib/pro-auth.ts`); comissão por profissional (Professional/Business); escala e disponibilidade |

### Segmentos em rotação

Salão/barbearia · spa/massoterapia · studio de unha/cílio/sobrancelha · clínica de estética · multi-unidade.

### Slugs canônicos (API)

`snake_case`, minúsculo, sem acento; a regra anti-repetição e as coortes de análise comparam esses slugs literalmente.

| Pilar | Slug |
|---|---|
| Dor → mecânica | `dor_mecanica` |
| Tela real / bastidores do produto | `tela_real_bastidores` |
| Educação de gestão | `educacao_gestao` |
| Objeção → resposta | `objecao_resposta` |
| Cliente final | `cliente_final` |
| Equipe | `equipe` |

| Segmento | Slug |
|---|---|
| Salão/barbearia | `salao_barbearia` |
| Spa/massoterapia | `spa_massoterapia` |
| Studio de unha/cílio/sobrancelha | `studio_unha_cilio_sobrancelha` |
| Clínica de estética | `clinica_estetica` |
| Multi-unidade | `multi_unidade` |

### Regra anti-repetição (obrigatória)

- **Pilar + segmento**: a mesma combinação não repete em **6 semanas**. Consulte as peças criadas nas últimas 6 semanas ISO via API antes de escolher.
- **Feature protagonista**: a mesma feature não é o assunto central de duas peças em **4 semanas**.
- Ao escolher pilar+segmento+formato para a rodada, monte a lista de combinações já usadas nas últimas 6 semanas a partir da consulta à API, elimine-as, e escolha dentre as restantes. Se não houver nenhuma feature elegível (não usada em 4 semanas) para o pilar/segmento sorteado, troque de pilar ou segmento antes de forçar uma repetição.

---

## 3. Regras de copy (obrigatórias, sem exceção)

1. **Mecânica real, nunca resultado garantido.** Fale do que o produto *faz* (link público, sinal via Stripe, portal da equipe), nunca de resultado de negócio não medido ("agenda cheia", "fatura mais", "reduz faltas em X%").
2. **Promessas proibidas.** Antes de escrever, tenha em mente as principais (lista completa e sempre atualizada em `docs/promessas-proibidas.json` — consulte o arquivo, não confie de memória):
   - Lembrete automático 24h antes (cron desligado em produção).
   - Pix como pagamento de sinal (só cartão hoje).
   - Qualquer número de "dinheiro perdido" ou "redução de faltas em %" sem fonte.
   - WhatsApp automático / notificação proativa (só existe botão click-to-send manual).
   - "Agenda cheia" ou qualquer resultado de negócio garantido.
   - "Sem nenhuma taxa" (a taxa de processamento da Stripe existe e é do estabelecimento — o correto é "sem taxa por agendamento" / "zero comissão do Agendaí").
   - Cliente preenchendo a própria anamnese (quem preenche é o profissional).
   - Cota/limite de agendamentos como diferencial (está desativada no código, nunca mencionar).
   - "30 dias grátis" sem qualificar (ver regra de CTA abaixo).
3. **CTA padrão**: `agendai.space — 30 dias grátis, sem cartão`. **Sempre** que a peça citar multi-unidade ou "várias unidades"/"mais de um estabelecimento", deixe explícito que o trial vale **só para o 1º estabelecimento do dono** — a 2ª unidade em diante começa sem trial, a preço cheio.
4. **Plano correto quando a feature é gated**: anamnese digital, comissões e mensagem WhatsApp custom = **Professional/Business**. E-mail de confirmação ao cliente e AgendaIA = **Business** (e-mail de confirmação exige plano pago, trial não conta). Fidelidade, pacotes, sinal, área do cliente e portal da equipe estão em **todos os planos** — não gate o que não é gated.
5. **Tom**: empreendedor para empreendedor. Curto — se não cabe numa tela de celular sem rolar, está longo demais. No máximo 1 emoji, nunca forçado. Sem jargão de tecnologia/marketing.
6. **Personagens LARA/CAMILA/JÚLIA**: usar **somente** em Reels IA, com as descrições **verbatim** do `01-produto-referencia.md` §8. Não usar em carrossel, estático ou stories.
7. **Toque humano obrigatório (agora via `imagePrompt` + aprovação).** O agente nunca gera nem sobe a imagem final. Toda peça leva um `imagePrompt` claro sobre a imagem/print/foto real que deve entrar na peça. O dono gera ou seleciona essa imagem e faz upload dela na interface de aprovação — **nenhuma peça é aprovada, e portanto nenhuma é publicada, sem uma imagem carregada.** Nunca escreva um `imagePrompt` vago o suficiente para resultar em visual genérico "cara de IA" no post final.
8. **Sem números de mercado sem fonte.** Se um dado de mercado for citado (ex.: "88% dos salões usam WhatsApp"), só use o que já está em `docs/01-produto-referencia.md` com fonte — nunca invente estatística nova.
9. **A peça em si não fala sobre o próprio processo de publicação.** O texto da peça é sobre o produto Agendaí para o público, nunca sobre como o Social Studio gera ou publica conteúdo. Internamente, toda peça nasce em `draft` e só vai ao ar depois de aprovação humana — isso é controlado pelo status no banco, não precisa (e não deve) aparecer na copy.

---

## 4. Passo a passo da rodada

Execute nesta ordem, sem pular etapas:

1. **Ler inputs** — seção 1 completa.
2. **Escolher pilar + segmento + formatos** conforme a rotação e a regra anti-repetição da seção 2.
3. **Criar as peças via API**, uma chamada `POST /api/pieces` por peça, com status inicial `draft` e os campos: pilar, segmento, formato, legenda, hashtags, `imagePrompt` e notas internas (divergências suspeitas, decisões de rotação, etc.).
4. **Claim-check da legenda**: o endpoint de criação roda automaticamente o claim-check (mesma lógica de `scripts/claim-check.mjs`) sobre a legenda antes de gravar. Se a API rejeitar (violação encontrada), leia a resposta, corrija a legenda e tente de novo. **Máximo 3 tentativas.** Se ainda falhar na 3ª tentativa, crie a peça mesmo assim com uma nota interna explicando o bloqueio, para o dono decidir manualmente na aprovação — não force a passagem editando `docs/promessas-proibidas.json` dentro da rodada (ver seção 8, edge case de falso positivo). Também é possível rodar a checagem localmente antes de chamar a API: `pnpm claim-check --text "<legenda>"`.
5. **Nenhum arquivo para atualizar** — o status `draft` e os metadados (pilar, segmento, formato, data) já ficam no banco de dados assim que a peça é criada; não há `log-pautas.md` para manter.
6. **Reportar o resultado da rodada** ao final da execução (na própria resposta do agente, sem escrever arquivo): peças criadas (id, formato, pilar, segmento), resultado do claim-check por peça, divergências suspeitas entre código e `01-produto-referencia.md` (se a checagem da seção 1, item 6, encontrou algo), e o que falta para o dono aprovar (principalmente: qual imagem gerar/escolher para cada `imagePrompt`).
7. **Entregar o resultado**: como toda peça já fica salva no banco via API assim que criada, não há commit nem Pull Request para essa etapa — a rotina só precisa de acesso HTTP autenticado (`GENERATION_API_TOKEN`) ao endpoint de geração. As peças aparecem automaticamente na interface de aprovação para o dono revisar.

---

## 5. Checklist de revisão humana pré-aprovação

O dono marca este checklist antes de aprovar qualquer peça na interface web (a aprovação é o que libera a peça para o cron de publicação):

- [ ] Mecânica real — nada de resultado de negócio garantido.
- [ ] Claim-check passou (verde) para a peça — a API já valida na criação, mas vale reconferir.
- [ ] CTA e trial corretos — se citar multi-unidade, trial qualificado como "1º estabelecimento".
- [ ] Plano correto citado quando a feature é gated (Professional/Business, conforme a tabela da seção 3).
- [ ] Imagem gerada/selecionada a partir do `imagePrompt` e carregada na interface — nada de visual genérico de IA no post final.
- [ ] Tom empreendedor→empreendedor, curto, sem jargão.
- [ ] No máximo 1 emoji.
- [ ] Hashtags: 5 a 8.
- [ ] Nenhum número de mercado sem fonte.
- [ ] Para Reels IA: vídeo gerado a partir do `imagePrompt`, revisado, sem "cara de IA" visível no rosto/fala dos personagens.
- [ ] Aprovar a peça na interface — o cron diário cuida da publicação via Instagram Graph API, não é preciso postar manualmente.
- [ ] 7 dias depois de publicada, preencher a métrica na interface (alcance, saves, comentários, cliques no link da bio) — coleta automática de insights é um recurso futuro, não implementado ainda.

---

## 6. Revisão mensal

Esta revisão agora é executada pela rotina de análise mensal documentada em `docs/rotina-analise.md`, que persiste o resultado via `POST /api/analysis` (visível na página `/analise` e consumido pela rotina semanal de geração via `GET /api/analysis/latest`). Os 4 passos abaixo continuam valendo como o que essa rotina precisa cobrir:

1x por mês (executada pela rotina de análise agendada, tipicamente na 1ª semana do mês):

1. Ler as métricas de peças publicadas do mês anterior — via `GET /api/analysis/source` (cron de insights do app já as coleta e as expõe agregadas), não direto do banco.
2. Ranquear pilares e formatos por `saves + comentários`.
3. Sugerir ajuste na rotação (seção 2) com base no ranking — por exemplo, promover um pilar com desempenho consistentemente melhor, sem violar a regra anti-repetição.
4. Verificar se `docs/01-produto-referencia.md` diverge do código atual do produto (features novas, desligadas ou com gate de plano alterado) e listar explicitamente o que precisa ser atualizado nesse documento — esta rotina **não edita** o `01-produto-referencia.md` diretamente, apenas sinaliza.
5. Analisar mercado — concorrentes/hashtags configurados em `/config` via `GET /api/analysis/market` (quando configurados) e tendências web — e produzir de 3 a 5 propostas de conteúdo originais, persistidas em `contentProposals`. A rotina semanal de geração pode usar cada proposta como candidata (no máximo 1 por rodada, sempre reescrita), sempre respeitando as seções 2 e 3 deste playbook.

---

## 7. Como configurar a recorrência

### 7a. Rotina cloud do Claude Code (executor principal, recomendado)

Roda na nuvem sobre o repositório `agendai-social` conectado — **não depende do Mac estar ligado**. Consegue ler os docs, chamar a API de criação de peças e rodar `pnpm claim-check` localmente se quiser validar antes de enviar.

- Existe uma segunda rotina cloud, independente desta, para a revisão mensal de desempenho — ver `docs/rotina-analise.md` para o passo a passo de configuração dessa rotina de análise.

**Como criar**: no Claude Code, use `/schedule` para criar uma rotina cloud com cron.

**Cron sugerido**: segunda-feira às 08:00 America/Sao_Paulo → em UTC: `0 11 * * 1`.

**Prompt exato a colar na rotina**:

```
Você é o agente de conteúdo do Agendaí Social Studio. Leia docs/02-playbook-conteudo.md
e execute uma rodada completa de conteúdo de Instagram para a semana ISO atual,
seguindo o playbook do início ao fim (seções 1 a 4).

Regras críticas (repetidas aqui caso o playbook não seja lido por algum motivo):
- Fonte factual única é docs/01-produto-referencia.md — nunca invente
  feature, número ou plano que não esteja lá.
- Nunca prometa resultado de negócio garantido, só mecânica real do produto.
- Crie cada peça via POST /api/pieces com status draft; o endpoint valida a
  legenda com o claim-check automaticamente (corrija até passar, máx. 3
  tentativas; se persistir, crie a peça mesmo assim com uma nota interna
  explicando o bloqueio).
- CTA padrão é "agendai.space — 30 dias grátis, sem cartão"; se citar
  multi-unidade, qualifique o trial como "1º estabelecimento".
- Toda peça precisa de um imagePrompt claro — você não gera nem sobe imagem,
  isso acontece na aprovação humana.
- A publicação no Instagram é automática após aprovação humana (cron diário via
  Graph API) — mas nenhuma peça é aprovada nem publicada sem revisão do dono.

Ao final, reporte na sua resposta: peças criadas (id, formato, pilar,
segmento), resultado do claim-check, e divergências suspeitas entre código e
01-produto-referencia.md, se houver.
```

**Como o dono revisa**: abre a interface de aprovação do Social Studio, revisa cada peça pelo checklist da seção 5, faz upload da imagem gerada a partir do `imagePrompt` e aprova. O cron diário publica as peças aprovadas automaticamente.

### 7b. Claude Cowork — tarefa agendada (executor sob demanda / alternativa)

Útil como alternativa ou para rodar sob demanda ("rode uma rodada agora"), mas **exige o Mac ligado e o app aberto no horário agendado**.

Passos:
1. Abrir o Claude Cowork.
2. Dar acesso à pasta do projeto `agendai-social` (e, se disponível, também `agendatmstudio` para checar divergência de código e localizar screenshots reais).
3. Criar uma Scheduled Task com frequência `weekly`, segunda-feira às 08:00.
4. Colar o **mesmo prompt** da seção 7a — o encerramento é idêntico (chamar a API), não há distinção de commit/PR nesta etapa.
5. Ressalvas: a chamada à API de criação de peças precisa do token `GENERATION_API_TOKEN`; garanta que o Cowork tenha acesso a essa variável/segredo antes de rodar.

Referência oficial: https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork

### 7c. Comparação rápida

| | Rotina cloud (Claude Code) | Cowork Scheduled Task |
|---|---|---|
| Precisa do Mac ligado? | Não | Sim, e app aberto no horário |
| Cria peças via API? | Sim | Sim, desde que tenha o token configurado |
| Roda `pnpm claim-check` localmente? | Sim, opcionalmente (a API já valida) | Só se tiver terminal disponível |
| Melhor para | Execução recorrente sem depender de máquina local | Rodada sob demanda / ambiente sem acesso HTTP direto configurado ainda |

---

## 8. Edge cases

- **Consulta de histórico esgotada** (todas as combinações pilar+segmento usadas nas últimas 6 semanas): recombine pilar × segmento inédito no período, ou use o pilar "educação de gestão" (c) com uma feature secundária ainda não protagonista nas últimas 4 semanas.
- **Feature mudou ou foi desligada no código** (detectado na checagem da seção 1, item 6): não gere peça sobre essa feature nesta rodada — sinalize a suspeita nas notas internas da peça para o humano confirmar e, se necessário, atualizar `01-produto-referencia.md` fora desta rodada.
- **Semana de feriado nacional**: sugira pauta sazonal usando mecânica real do produto — por exemplo, bloqueios de agenda para o feriado (`AppointmentBlock`/exceções recorrentes) ou promoções por dia/horário. Nunca invente campanha sem mecânica correspondente no produto.
- **Ferramenta de geração de vídeo limita a duração**: divida o `imagePrompt` do Reel em clipes de 8-10s, mantendo os 4 personagens/cenas consistentes (ver `01-produto-referencia.md` §8).
- **Claim-check com falso positivo**: não desligue nem contorne o script. Ajuste o campo `allow` do item correspondente em `docs/promessas-proibidas.json` **fora do fluxo de criação de peças**, em uma revisão isolada do dono.
- **Endpoint de publicação falha** (peça marcada `failed` pelo cron): isso é um problema de infraestrutura/token do Graph API, não de conteúdo — o playbook não cobre esse caso além de sinalizar; a peça permanece `failed` até o dono investigar (fora do escopo deste documento).
