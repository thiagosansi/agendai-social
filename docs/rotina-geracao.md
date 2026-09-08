# Rotina de geração semanal — guia operacional

**Propósito**: este documento é o guia operacional para configurar a rotina automatizada (cloud, agendada) que gera as peças de conteúdo do Agendaí Social Studio toda semana. Ele complementa — não substitui — `docs/02-playbook-conteudo.md` (o contrato editorial) e `docs/01-produto-referencia.md` (a fonte factual). A rotina em si é apenas a "cola operacional": onde rodar, com qual prompt, com quais credenciais, com quais travas de segurança.

**Quem configura a rotina**: o dono (Thiago), uma única vez, via `/schedule` no Claude Code. **Este documento não cria a rotina sozinho** — a criação é sempre uma ação explícita do dono, que revisa o prompt abaixo antes de colar.

---

## 1. O prompt da rotina

Cole este prompt (sem alterações, exceto se o dono quiser um override pontual do número de peças desta execução específica) ao criar a rotina agendada. Cadência (peças por rodada, dias e horário de postagem, frequência de geração) não se ajusta mais editando este prompt — o dono configura tudo isso em `/config` → "Cadência de postagem" / "Frequência de geração", e a rotina lê os valores atuais a cada execução via `GET /api/report/latest` (passo 2). `piecesPerRound` substitui o antigo parâmetro `PECAS_POR_RODADA`:

```
Você é o agente de geração de conteúdo do Agendaí Social Studio. Execute uma
rodada completa de geração de conteúdo de Instagram para a semana ISO atual.
Siga estes passos, nesta ordem, sem pular nenhum:

0. INVOCAR A SKILL DE ESTRATEGISTA: use a Skill tool para carregar
   `agendai-social-strategist` (arquivo
   `.claude/skills/agendai-social-strategist/SKILL.md` no repositório) e
   siga suas regras duras e fórmulas ao escrever legendas e imagePrompts.
   Se a Skill tool não estiver disponível, leia o arquivo diretamente.

1. LER OS DOCUMENTOS-FONTE (no repositório agendai-social):
   - docs/01-produto-referencia.md — fonte factual única do produto. Nenhum
     benefício, número ou feature pode aparecer em copy se não estiver aqui.
   - docs/02-playbook-conteudo.md — contrato editorial completo (pilares,
     segmentos, cadência, regras de copy, rotação anti-repetição). Este
     prompt resume o essencial, mas o playbook é a fonte de verdade em caso
     de dúvida ou conflito.

2. BUSCAR O RELATÓRIO DE DESEMPENHO:
   GET {APP_URL}/api/report/latest
   Header: Authorization: Bearer {GENERATION_API_TOKEN}

   SE ESTA CHAMADA FALHAR (erro de rede, status != 200, token inválido):
   ABORTE A RODADA IMEDIATAMENTE. Não gere nenhuma peça. Reporte o erro no
   resumo final. Nunca gere conteúdo sem conseguir consultar o relatório —
   é o sinal de que a API está no ar e as credenciais estão corretas.

   GATES DE CADÊNCIA (verifique nesta ordem, com a resposta em mãos, antes de
   qualquer outra coisa — o dono controla isso em `/config`):
   - Se `generationPaused === true`: ABORTE A RODADA. Não gere nenhuma peça.
     Reporte no resumo final: "geração pausada em /config".
   - Se `generationDue === false`: ABORTE A RODADA. Não gere nenhuma peça.
     Reporte no resumo final: "fora do prazo (intervalo configurado de
     `generationIntervalWeeks` semanas; próxima rodada devida quando
     `generationDue` voltar a `true`)". `generationDue` já incorpora o botão
     manual "Gerar rodada agora" (flag one-shot `forceNextGeneration`) — a
     rotina nunca precisa ler essa flag diretamente, só confiar em
     `generationDue`.
   - Se `generationPaused === false` e `generationDue === true`, prossiga
     normalmente para o restante deste passo e para os passos seguintes.

   CADÊNCIA DESTA RODADA: leia `piecesPerRound` (inteiro, 1 a 4) como o
   número EXATO de peças a gerar nesta rodada — ver passo 4. Leia
   `nextPublishSlots` (array com `piecesPerRound` strings ISO 8601 UTC) como
   a lista exata de `publishAt`, uma por peça, na ordem — ver passo 5.
   `postingWeekdayLabels` e `postingTime` são só informativos (para citar no
   racional do resumo final); não recalcule fuso ou dia da semana a partir
   deles enquanto `nextPublishSlots` vier preenchido — copie os slots
   verbatim.

   Use o campo `recommendations` e o ranking `rankingPilarFormato` para
   enviesar a escolha de pilar/formato desta rodada (ex.: priorizar o combo
   com melhor engajamento médio, evitar o combo sinalizado como fraco — mas
   sem violar a regra anti-repetição da seção 3 do playbook). Se o relatório
   vier vazio ou com "sem dados suficientes", siga a rotação default da
   seção 2 do playbook.

2b. BUSCAR A ÚLTIMA ANÁLISE DE DESEMPENHO:
    GET {APP_URL}/api/analysis/latest
    Header: Authorization: Bearer {GENERATION_API_TOKEN}

    Em caso de 200, use `insights.hookPatterns`, `insights.captionPatterns`,
    `insights.imagePromptGuidelines` e `insights.formatTactics`, além de
    `recommendations`, para enviesar (i) a escolha entre os combos
    pilar/segmento/formato ELEGÍVEIS desta rodada, (ii) a estrutura do
    hook/legenda e (iii) o `imagePrompt`. Em caso de 404 (ainda não existe
    análise), siga apenas o relatório + a rotação, sem análise. Em caso de
    erro de rede ou status diferente de 200/404, isso NÃO é fatal (ao
    contrário do passo 2): continue a rodada sem a análise e mencione a
    falha no resumo final.

    REGRA DE PRECEDÊNCIA (obrigatória): playbook (rotação, anti-repetição e
    regras de copy) > relatório (`recommendations`/`rankingPilarFormato` de
    /api/report/latest) > análise (/api/analysis/latest). A análise só
    desempata entre opções já elegíveis e só influencia como escrever —
    nunca autoriza violar rotação, anti-repetição, claims proibidas ou o
    limite de peças por rodada. Toda rodada deve incluir pelo menos 1
    elemento de teste (hook ou ângulo) fora do padrão vencedor indicado
    pela análise (anti-drift).

    PROPOSTAS DE CONTEÚDO (`contentProposals`, quando presentes no
    relatório): trate-as como CANDIDATAS, nunca como peças finais. No
    máximo 1 peça da rodada (independente de quantas `piecesPerRound`
    define no total) pode partir de uma `contentProposal`.
    Uma proposta só é elegível se seu pilar+segmento não violar a regra
    anti-repetição (passo 3) e seu formato bater com a rotação da semana
    A/B (passo 4). Se elegível, SEMPRE reescreva a peça a partir da
    proposta — nunca cole o `captionDraft` literalmente — mantendo o CTA
    padrão e as hashtags do playbook, e ainda assim rode a auto-checagem
    de claims (passo 6). Registre no resumo (passo 8) qual proposta foi
    usada (índice + hook) ou, se nenhuma era elegível, por quê.

3. BUSCAR O HISTÓRICO RECENTE PARA A REGRA ANTI-REPETIÇÃO:
   GET {APP_URL}/api/pieces?since=6w
   (sem autenticação — este endpoint GET é público, ver README do repo)

   A partir da lista retornada, monte o conjunto de combinações
   pilar+segmento já usadas nas últimas 6 semanas ISO — não escolha nenhuma
   combinação que já apareça nesse conjunto (regra do playbook §2, "Regra
   anti-repetição"). Adicionalmente, a API rejeita com 409 qualquer peça
   cuja combinação pilar+segmento+formato já exista na MESMA semana ISO —
   trate esse 409 como sinal para trocar de combinação, não como erro fatal
   (ver passo 6).

4. ESCOLHER OS FORMATOS DA RODADA (rotação de 2 semanas, playbook §2):
   - Semana ISO com número ÍMPAR = Semana A → par de formatos: carrossel +
     stories.
   - Semana ISO com número PAR = Semana B → par de formatos: reels + estático.
   (Use o número da semana ISO do ano corrente, ex. semana 33 = ímpar =
   Semana A. Calcule a semana ISO da data de execução da rotina, não da
   data de publicação.)

   Gere exatamente `piecesPerRound` peças nesta rodada — valor lido no
   passo 2 do relatório (teto de 4 já imposto pela API/Config, a rotina não
   precisa revalidar isso). Mapeie `piecesPerRound` para formatos assim:
   - `piecesPerRound = 2`: use o par de formatos da semana (A ou B acima).
   - `piecesPerRound = 1`: use só o primeiro formato do par da semana
     (carrossel na Semana A, reels na Semana B).
   - `piecesPerRound = 3` ou `4`: comece pelo par da semana e complete com
     o par da outra semana (B ou A, na ordem) até atingir o total — nunca
     gere 2 peças do mesmo formato na mesma rodada sem justificar isso
     explicitamente no resumo final (passo 8).
   OVERRIDE PONTUAL: se o prompt desta execução específica pedir
   explicitamente um número de peças diferente de `piecesPerRound` (até 4),
   esse override vence o valor do relatório só para esta rodada — nunca
   gere acima de 4 em nenhuma hipótese.

   Para cada peça, escolha um pilar e um segmento (playbook §2, tabelas de
   pilares e segmentos) que não violem a regra anti-repetição do passo 3, e
   que sejam distintos entre as peças desta rodada. Use os slugs canônicos
   de pilar/segmento (snake_case) da tabela do playbook §2 — os mesmos já
   usados nas peças existentes.

5. ESCREVER AS PEÇAS DA RODADA (piecesPerRound):
   Aplique as fórmulas de hook e a estrutura de legenda da skill
   `agendai-social-strategist` carregada no passo 0, e não reutilize nenhum
   hook já usado nas legendas das peças das últimas 6 semanas (consulte
   `GET /api/pieces?since=6w` do passo 3 para essa checagem).

   Para cada peça, produza:
   - `caption`: legenda em pt-BR seguindo TODAS as regras de copy do
     playbook §3 (mecânica real nunca resultado garantido; CTA padrão
     "agendai.space — 30 dias grátis, sem cartão"; se citar multi-unidade,
     qualificar o trial como "1º estabelecimento"; plano correto quando a
     feature é gated; tom empreendedor-para-empreendedor, curto, no máximo
     1 emoji; personagens LARA/CAMILA/JÚLIA só em reels, descrições
     verbatim do 01-produto-referencia §8; hashtags 5 a 8 incluídas no
     final do texto da legenda — não há campo separado de hashtags no
     modelo de dados). Todo claim factual vem exclusivamente de
     01-produto-referencia.md.
   - `imagePrompt`: o app gera a foto automaticamente, server-side, a
     partir deste campo (modelo FLUX.2 Klein via Cloudflare Workers AI) —
     por isso o prompt precisa ser **executável**, não apenas descritivo
     para um humano. Escreva **em inglês** (o modelo é inglês-first), de
     forma concreta e específica: cena, sujeito, luz natural, paleta sage
     green + off-white, ângulo, estilo de foto real, e feche com uma
     instrução explícita contra visual genérico de IA (ex.: `"no AI look,
     real photography style"`). **O prompt descreve só a cena — nunca peça
     texto, letra, placa, logo ou marca d'água nele.** O modelo erra
     ortografia em português (ex. "Confirmação" vira "Confimação", "grátis"
     vira "cráis") e inventa texto em telas de app quando o prompt pede
     texto; por isso o app já acrescenta automaticamente uma instrução
     "no text" ao prompt enviado ao modelo, e o prompt escrito pela rotina
     não deve pedir nenhum texto por conta própria. Evite também cenas com
     tela de celular/computador **legível** em foco — o modelo inventa
     interface e números; prefira ambiente, pessoas, mãos, objetos e
     detalhes do salão/spa, com telas (quando aparecerem) desfocadas ao
     fundo, nunca como foco da composição. Proporção: feed
     (`carrossel`/`estatico`) é 4:5 (1024x1280); `stories` é 9:16
     (1080x1920) — cite a proporção no prompt. Para `carrossel`, use
     também o campo `imagePrompts` (array de strings, 2 a 10 itens, **um
     prompt executável por slide, na mesma ordem dos slides**, cada um
     seguindo as regras acima — cena só, sem texto) — nesse caso
     `imagePrompt` vira o **resumo da direção visual comum** (paleta,
     ambiente, estilo compartilhado entre os slides) e serve de fallback:
     se `imagePrompts` faltar, o app gera só a capa e avisa isso na fila.
     Mantenha consistência visual entre os slides (mesmo ambiente, mesma
     paleta). Se tiver acesso a screenshots reais do produto (pasta
     `Imagens/` no repositório principal agendatmstudio, quando
     acessível), pode citar o print como referência de composição, mas o
     prompt ainda precisa descrever a cena por extenso — o modelo de
     imagem não tem acesso ao arquivo.
   - `overlayText` (estático e stories) / `overlayTexts` (carrossel): o
     texto que aparece **sobre** a foto vai nestes campos próprios, em
     pt-BR **verbatim** — nunca dentro do `imagePrompt`. O app compõe o
     texto por cima da foto gerada (fonte Inter Bold, branco, sobre um
     gradiente escuro suave no topo da imagem); a foto em si sai sempre
     limpa, sem nenhum texto renderizado pelo modelo. Regras editoriais:
     3 a 8 palavras por linha, no máximo 2 linhas (quebra manual com `\n`
     permitida quando precisar de 2 linhas), sem emoji, ortografia
     impecável (é texto pt-BR real, não hallucination do modelo de
     imagem). `overlayText` é uma única string (até 200 caracteres) usada
     em `estatico` e `stories`. `overlayTexts` é um array com **um item
     por slide, na mesma ordem e no mesmo tamanho de `imagePrompts`**
     (carrossel) — uma string vazia (`""`) marca slide sem overlay; slide
     1 = hook (mesma ideia da 1ª linha da legenda), último slide = CTA
     padrão. `overlayTexts` só é aceito quando `format` é `carrossel`.
     Para `reels`, o campo `imagePrompt` continua sendo um
     **briefing/roteiro de vídeo** em pt-BR, não um prompt de imagem: cena
     a cena, texto na tela quando houver overlay, duração alvo (≤ 60–90s,
     nunca acima do `MAX_REELS_DURATION_SEC` de 900s), personagem
     LARA/CAMILA/JÚLIA quando aplicável (descrições verbatim do
     01-produto-referencia §8), formato 9:16. O app gera imagem
     automaticamente para os outros formatos, mas **não gera vídeo**: o
     dono grava/edita o MP4 (ou MOV) e faz o upload direto na UI da fila
     (`/fila`, componente `PieceCard`) na hora de aprovar.
   - `publishAt`: use `nextPublishSlots[i]` do relatório (passo 2) para a
     i-ésima peça desta rodada, VERBATIM — copie a string ISO 8601 UTC tal
     como veio, sem recalcular fuso ou dia da semana. Os slots já vêm
     distribuídos conforme os dias/horário configurados em `/config` →
     "Cadência de postagem", então peças da mesma rodada já nascem em
     dias/horários diferentes por padrão, sem esforço extra da rotina.
     FALLBACK: se `nextPublishSlots` vier vazio ou com menos entradas que
     `piecesPerRound`, use como próximos slots os dias listados em
     `postingWeekdayLabels` no horário `postingTime`, fuso
     America/Sao_Paulo (BRT, UTC-3, Brasil não observa horário de verão),
     convertidos para ISO 8601 UTC — e reporte essa divergência no resumo
     final (passo 8).

6. AUTO-CHECAGEM DE CLAIMS PROIBIDAS (antes de enviar cada peça):
   Se tiver acesso ao repositório (execução com checkout do agendai-social):
     node scripts/claim-check.mjs --text "<caption>"
   Se não tiver acesso ao repositório (execução via API pura): faça a
   checagem manualmente, comparando a legenda contra a lista de padrões
   proibidos abaixo (versão resumida de docs/promessas-proibidas.json —
   busque o arquivo completo se possível, esta lista pode ficar
   desatualizada):
     - "lembrete automático" / "lembrete 24h" / "notificação automática"
     - "sinal por/via/no pix", "pix online", "pagamento via pix", "qr code pix"
     - "whatsapp automático", "mensagem automática", "notificação via whatsapp"
     - redução de faltas em % (ex. "reduz faltas em 30%")
     - "agenda cheia", "agenda lotada", "resultado garantido"
     - "R$ X perdidos" sem fonte
     - "sem nenhuma taxa" / "sem taxa" isolado (permitido: "sem taxa por
       agendamento", "zero comissão do Agendaí")
     - "e-mail de confirmação" sem qualificar como recurso do plano Business
     - "cliente preenche a própria anamnese"
     - qualquer menção a limite/cota de agendamentos por mês
     - "30 dias grátis" citando unidade adicional/multi-unidade sem
       qualificar como "1º estabelecimento"
     - "sincroniza com Google Calendar", "integração com Google Calendar"
     - "Reserve with Google", "botão reservar do Instagram"
     - "lista de espera", "cupom de desconto", "app na app store/play store"

   Se encontrar violação, reescreva a legenda usando a substituta sugerida
   (campo `substitute` de cada regra) e verifique de novo antes de prosseguir.

7. CRIAR CADA PEÇA VIA API:
   POST {APP_URL}/api/pieces
   Header: Authorization: Bearer {GENERATION_API_TOKEN}
   Header: Content-Type: application/json
   Body: { "pillar", "segment", "format", "caption", "imagePrompt",
   "imagePrompts"?, "overlayText"?, "overlayTexts"?, "publishAt" } —
   `imagePrompts` é opcional e só vale para `format: "carrossel"` (array
   de 2 a 10 strings, um prompt por slide, na ordem); omita o campo para
   os demais formatos. `overlayText` (string, até 200 caracteres) vale
   para `estatico`/`stories`; `overlayTexts` (array, mesmo tamanho de
   `imagePrompts`, um item por slide, string vazia = slide sem overlay)
   vale só para `carrossel`.

   - Se a resposta for 201: peça criada como draft, com
     `imageGenStatus: "queued"` no corpo (quando a geração automática de
     imagem estiver configurada no app — envs `CLOUDFLARE_ACCOUNT_ID` /
     `CLOUDFLARE_API_TOKEN`) ou `"idle"` (feature desligada, upload segue
     manual). Guarde o `id` retornado. A geração roda em background — não
     é preciso esperar nem chamar nenhum endpoint adicional para ela
     começar.
   - Se a resposta for 400 (`{"error":"imagePrompts só é permitido em
     carrossel"}`): o campo `imagePrompts` foi enviado para um formato
     diferente de `carrossel` — remova o campo do body e tente de novo.
   - Se a resposta for 400 (`{"error":"overlayTexts só é permitido em
     carrossel"}`): o campo `overlayTexts` foi enviado para um formato
     diferente de `carrossel` — use `overlayText` (string única) nesse
     caso e tente de novo.
   - Se a resposta for 400 (`{"error":"overlayTexts deve ter o mesmo
     tamanho de imagePrompts"}`): o array `overlayTexts` não bate em
     tamanho com `imagePrompts` (isso também dispara se `overlayTexts`
     vier sem `imagePrompts` no body) — ajuste os dois arrays para o
     mesmo número de itens, um por slide, e tente de novo.
   - Se a resposta for 422 (claim-check rejeitou no servidor): leia
     `violations`, corrija a legenda e tente novamente — no máximo 1 nova
     tentativa por peça. Se falhar de novo, NÃO force a peça sem legenda
     corrigida; pule essa peça e reporte o motivo no resumo final.
   - Se a resposta for 409 (combinação pilar+segmento+formato já existe
     nessa semana ISO): escolha outra combinação de pilar/segmento/formato
     ainda elegível (volte ao passo 3/4) e tente criar a peça de novo com a
     nova combinação. Não insista na mesma combinação.

8. REPORTAR O RESULTADO (na própria resposta da execução, sem criar
   arquivo novo no repositório):
   - Peças criadas: id, pilar, segmento, formato, publishAt.
   - Racional de cada escolha, citando o que veio do relatório
     (`recommendations`/`rankingPilarFormato`) e o que veio da rotação
     default.
   - Resultado do claim-check de cada legenda.
   - Divergências suspeitas entre código e 01-produto-referencia.md, se
     detectadas (playbook §1, item 6) — apenas sinalize, nunca corrija o
     documento nesta rotina.
   - Se alguma peça foi pulada (422 persistente ou 409 sem combinação
     elegível), diga isso explicitamente.

REGRAS QUE NUNCA MUDAM, independente do que constar acima:
- Nunca aprove nem publique nada. Toda peça criada por esta rotina nasce e
  fica em status "draft" — quem aprova é sempre o dono, na interface web.
- Nunca edite código, o playbook, o produto-referência ou qualquer arquivo
  do repositório. Esta rotina só lê docs e chama a API HTTP.
- No máximo `piecesPerRound` peças por rodada (valor do relatório,
  configurável em /config → "Cadência de postagem", teto 4) — a rotina
  nunca sobe esse número sozinha; só o dono, via /config ou via um override
  pontual explícito no prompt daquela execução específica (nunca acima de
  4).
- Respeita os gates de cadência do passo 2: nunca gera nenhuma peça quando
  `generationPaused === true` ou `generationDue === false`.
- Se qualquer chamada de API obrigatória falhar (relatório ou criação de
  peça por motivo que não seja 409/422 tratável), pare e reporte — nunca
  invente dados para contornar uma falha de infraestrutura.
```

---

## 2. Variáveis de ambiente

| Variável | Necessária para | Como passar para a rotina |
|---|---|---|
| `APP_URL` | Montar as URLs completas de `GET /api/report/latest`, `GET /api/pieces` e `POST /api/pieces` no prompt acima (ex.: `https://agendai-social.vercel.app` em produção, ou `http://localhost:3040` durante testes locais). | Não é secreto — pode ir literal no prompt da rotina, ou como variável de ambiente da rotina cloud se o Claude Code suportar interpolação de env em scheduled routines. |
| `GENERATION_API_TOKEN` | Autenticar `GET /api/report/latest`, `GET /api/analysis/latest` (passo 2b do prompt) e `POST /api/pieces` (bearer token, ver `lib/auth.ts`). Mesmo valor configurado na env do projeto Social Studio (Vercel/produção) ou no `.env` local (`dev-token-change-me` em dev). | **Secreto.** Configurar como variável de ambiente/secret da rotina agendada no Claude Code (`/schedule` pede para declarar env vars/secrets ao criar a rotina) — nunca colar o valor literal dentro do texto do prompt. |

Não há outras variáveis obrigatórias para a rotina de geração — `CRON_SECRET`, `META_IG_*` e `BLOB_READ_WRITE_TOKEN` pertencem ao cron de publicação e à aprovação, fora do escopo desta rotina.

---

## 3. Passo a passo — criando a rotina com `/schedule`

**Variante primária: acesso ao repositório `agendai-social`** (a rotina lê `docs/01-produto-referencia.md` e `docs/02-playbook-conteudo.md` direto do checkout, e opcionalmente roda `pnpm claim-check` localmente antes de chamar a API):

1. No Claude Code, com o projeto `agendai-social` conectado/acessível pela rotina cloud, rode `/schedule` (ou use a skill `schedule`).
2. Escolha frequência semanal. Sugestão alinhada com `docs/02-playbook-conteudo.md` §7a: **segunda-feira às 08:00 America/Sao_Paulo**, que em UTC é `0 11 * * 1`. (O dono pode ajustar o horário; o importante é rodar 1x por semana, antes do primeiro slot de publicação da rodada.)
3. Cole o prompt completo da seção 1 deste documento como instrução da rotina.
4. Substitua `{APP_URL}` no prompt colado pela URL real do deploy do Social Studio (ou deixe como variável se a interface de `/schedule` suportar).
5. Configure `GENERATION_API_TOKEN` como variável de ambiente/secret da rotina (nunca como texto literal no prompt) — passo 3 do `/schedule`.
6. Confirme que a rotina terá acesso de leitura ao repositório `agendai-social` (para os dois documentos-fonte, a skill `agendai-social-strategist` e, opcionalmente, `scripts/claim-check.mjs`).
7. Confirme que os `allowed_tools` da rotina incluem `Skill` (além de `Bash`, `Read`, `Glob`, `Grep`, `WebFetch`) — é o que permite o passo 0 do prompt carregar `agendai-social-strategist` via Skill tool. Nunca inclua `Write`/`Edit`.
8. Salve a rotina. Rode uma execução manual de teste antes de deixá-la 100% automática, e confira o resumo final (peças criadas, ids, racional) contra o checklist da seção 4 abaixo.

**Variante alternativa: sem acesso ao repositório** (a rotina roda em um ambiente que só tem acesso HTTP, sem checkout do código):

1. Siga os mesmos passos 1–2, 5 acima.
2. No prompt, substitua o passo 1 ("LER OS DOCUMENTOS-FONTE") por instruções para buscar os dois documentos via `WebFetch`/`GET` nas URLs raw do repositório (ex.: `https://raw.githubusercontent.com/<org>/agendai-social/main/docs/01-produto-referencia.md` e o equivalente para `docs/02-playbook-conteudo.md`) — ajuste a URL para o branch/host reais do repositório.
3. Como esta variante não tem acesso ao repositório, a Skill tool não pode carregar `agendai-social-strategist`; substitua o passo 0 por uma busca via `WebFetch` na URL raw de `.claude/skills/agendai-social-strategist/SKILL.md` (mesmo host/branch usado no passo 2 acima) e siga o conteúdo lido como se fosse a skill.
4. No passo 6 (auto-checagem de claims), a rotina não terá `node scripts/claim-check.mjs` disponível — ela deve usar exclusivamente a checagem manual descrita no próprio prompt (lista resumida de padrões proibidos), e confiar na validação de servidor (422) como rede de segurança final.
5. Esta variante é mais frágil (lista de claims proibidas pode ficar desatualizada no prompt colado) — prefira a variante primária sempre que possível.

---

## 4. Guard-rails (obrigatórios, sem exceção)

- **Nunca aprova nem publica.** A rotina só cria peças em status `draft` via `POST /api/pieces`. Aprovação (o app gera a foto automaticamente a partir do `imagePrompt`/`imagePrompts` da peça e compõe o texto de `overlayText`/`overlayTexts` por cima; o dono revisa, regenera a foto, reaplica o texto (`mode: "recompose"`) ou substitui por upload manual) e publicação (cron diário via Graph API) são etapas humanas/automatizadas separadas, fora do escopo desta rotina.
- **Nunca edita código.** A rotina não tem (e não deve ter) permissão de escrita no repositório — nem no produto (`agendatmstudio`), nem no próprio `agendai-social` (nem os docs, nem a UI, nem a API). Ela só lê docs e chama a API HTTP.
- **Aborta se a API estiver inacessível.** Se `GET /api/report/latest` falhar (rede, 5xx, 401 por token errado), a rotina para imediatamente e não gera nenhuma peça — nunca preenche dados de relatório "de memória" ou inventados.
- **No máximo `piecesPerRound` peças por rodada** — valor lido de `GET /api/report/latest`, configurável pelo dono em `/config` → "Cadência de postagem" (teto 4; `PECAS_POR_RODADA` era o nome legado desse parâmetro no prompt, antes de virar configuração persistida), salvo override pontual explícito no prompt daquela execução específica. A rotina nunca decide sozinha subir esse número.
- **Respeita os gates de cadência.** Se `generationPaused === true` ou `generationDue === false` na resposta de `GET /api/report/latest`, a rotina aborta sem gerar nenhuma peça (passo 2 do prompt) — o dono controla pausa e frequência via `/config`.
- **A análise nunca sobrepõe o playbook.** `/api/analysis/latest` só influencia estilo e desempate entre opções já elegíveis pela rotação/anti-repetição — nunca autoriza violar o playbook.
- **Propostas de conteúdo nunca substituem a rotação.** No máx. 1 peça por rodada nasce de uma `contentProposal`, e sempre reescrita — nunca o `captionDraft` colado literalmente.
