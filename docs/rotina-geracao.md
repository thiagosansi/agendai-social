# Rotina de geração semanal — guia operacional

**Propósito**: este documento é o guia operacional para configurar a rotina automatizada (cloud, agendada) que gera as peças de conteúdo do Agendaí Social Studio toda semana. Ele complementa — não substitui — `docs/02-playbook-conteudo.md` (o contrato editorial) e `docs/01-produto-referencia.md` (a fonte factual). A rotina em si é apenas a "cola operacional": onde rodar, com qual prompt, com quais credenciais, com quais travas de segurança.

**Quem configura a rotina**: o dono (Thiago), uma única vez, via `/schedule` no Claude Code. **Este documento não cria a rotina sozinho** — a criação é sempre uma ação explícita do dono, que revisa o prompt abaixo antes de colar.

---

## 1. O prompt da rotina

Cole este prompt (sem alterações, exceto se o dono quiser ajustar o `PECAS_POR_RODADA` pontualmente) ao criar a rotina agendada:

```
Você é o agente de geração de conteúdo do Agendaí Social Studio. Execute uma
rodada completa de geração de conteúdo de Instagram para a semana ISO atual.
Siga estes passos, nesta ordem, sem pular nenhum:

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

   Use o campo `recommendations` e o ranking `rankingPilarFormato` para
   enviesar a escolha de pilar/formato desta rodada (ex.: priorizar o combo
   com melhor engajamento médio, evitar o combo sinalizado como fraco — mas
   sem violar a regra anti-repetição da seção 3 do playbook). Se o relatório
   vier vazio ou com "sem dados suficientes", siga a rotação default da
   seção 2 do playbook.

   SE ESTA CHAMADA FALHAR (erro de rede, status != 200, token inválido):
   ABORTE A RODADA IMEDIATAMENTE. Não gere nenhuma peça. Reporte o erro no
   resumo final. Nunca gere conteúdo sem conseguir consultar o relatório —
   é o sinal de que a API está no ar e as credenciais estão corretas.

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
   - Semana ISO com número ÍMPAR = Semana A → gerar carrossel + stories.
   - Semana ISO com número PAR = Semana B → gerar reels + estático.
   (Use o número da semana ISO do ano corrente, ex. semana 33 = ímpar =
   Semana A. Calcule a semana ISO da data de execução da rotina, não da
   data de publicação.)

   Escolha 2 pilares e 2 segmentos distintos (playbook §2, tabelas de
   pilares e segmentos) que não violem a regra anti-repetição do passo 3.
   PECAS_POR_RODADA default é 2 — só gere mais se o prompt desta execução
   específica disser explicitamente para subir até 4.

5. ESCREVER AS 2 PEÇAS:
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
   - `imagePrompt`: descrição detalhada o suficiente para o dono gerar ou
     escolher a imagem certa — composição, estilo (wellness: sage green +
     off-white, luz natural, ambiente real, nunca clichê de banco de
     imagens ou "cara de IA" genérica), conteúdo exato de qualquer overlay
     de texto, proporção (1:1 ou 4:5 para carrossel/estático, 9:16 para
     stories/reels). Se tiver acesso a screenshots reais do produto (pasta
     `Imagens/` no repositório principal agendatmstudio, quando acessível),
     cite o print exato; caso contrário, descreva a cena com detalhe
     suficiente.
   - `publishAt`: próximo slot apropriado, terça ou quinta-feira às 11:00
     America/Sao_Paulo (UTC-3, Brasil não observa horário de verão),
     expresso em ISO 8601 UTC (ex.: 11:00 BRT = 14:00:00Z). Distribua as 2
     peças em dias diferentes da mesma rodada.

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
   Body: { "pillar", "segment", "format", "caption", "imagePrompt", "publishAt" }

   - Se a resposta for 201: peça criada como draft. Guarde o `id` retornado.
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
- Nunca gere mais de 2 peças nesta rodada, a menos que o prompt desta
  execução específica autorize explicitamente um número maior (até 4).
- Se qualquer chamada de API obrigatória falhar (relatório ou criação de
  peça por motivo que não seja 409/422 tratável), pare e reporte — nunca
  invente dados para contornar uma falha de infraestrutura.
```

---

## 2. Variáveis de ambiente

| Variável | Necessária para | Como passar para a rotina |
|---|---|---|
| `APP_URL` | Montar as URLs completas de `GET /api/report/latest`, `GET /api/pieces` e `POST /api/pieces` no prompt acima (ex.: `https://agendai-social.vercel.app` em produção, ou `http://localhost:3040` durante testes locais). | Não é secreto — pode ir literal no prompt da rotina, ou como variável de ambiente da rotina cloud se o Claude Code suportar interpolação de env em scheduled routines. |
| `GENERATION_API_TOKEN` | Autenticar `GET /api/report/latest` e `POST /api/pieces` (bearer token, ver `lib/auth.ts`). Mesmo valor configurado na env do projeto Social Studio (Vercel/produção) ou no `.env` local (`dev-token-change-me` em dev). | **Secreto.** Configurar como variável de ambiente/secret da rotina agendada no Claude Code (`/schedule` pede para declarar env vars/secrets ao criar a rotina) — nunca colar o valor literal dentro do texto do prompt. |

Não há outras variáveis obrigatórias para a rotina de geração — `CRON_SECRET`, `META_IG_*` e `BLOB_READ_WRITE_TOKEN` pertencem ao cron de publicação e à aprovação, fora do escopo desta rotina.

---

## 3. Passo a passo — criando a rotina com `/schedule`

**Variante primária: acesso ao repositório `agendai-social`** (a rotina lê `docs/01-produto-referencia.md` e `docs/02-playbook-conteudo.md` direto do checkout, e opcionalmente roda `pnpm claim-check` localmente antes de chamar a API):

1. No Claude Code, com o projeto `agendai-social` conectado/acessível pela rotina cloud, rode `/schedule` (ou use a skill `schedule`).
2. Escolha frequência semanal. Sugestão alinhada com `docs/02-playbook-conteudo.md` §7a: **segunda-feira às 08:00 America/Sao_Paulo**, que em UTC é `0 11 * * 1`. (O dono pode ajustar o horário; o importante é rodar 1x por semana, antes do primeiro slot de publicação da rodada.)
3. Cole o prompt completo da seção 1 deste documento como instrução da rotina.
4. Substitua `{APP_URL}` no prompt colado pela URL real do deploy do Social Studio (ou deixe como variável se a interface de `/schedule` suportar).
5. Configure `GENERATION_API_TOKEN` como variável de ambiente/secret da rotina (nunca como texto literal no prompt) — passo 3 do `/schedule`.
6. Confirme que a rotina terá acesso de leitura ao repositório `agendai-social` (para os dois documentos-fonte e, opcionalmente, `scripts/claim-check.mjs`).
7. Salve a rotina. Rode uma execução manual de teste antes de deixá-la 100% automática, e confira o resumo final (peças criadas, ids, racional) contra o checklist da seção 4 abaixo.

**Variante alternativa: sem acesso ao repositório** (a rotina roda em um ambiente que só tem acesso HTTP, sem checkout do código):

1. Siga os mesmos passos 1–2, 5 acima.
2. No prompt, substitua o passo 1 ("LER OS DOCUMENTOS-FONTE") por instruções para buscar os dois documentos via `WebFetch`/`GET` nas URLs raw do repositório (ex.: `https://raw.githubusercontent.com/<org>/agendai-social/main/docs/01-produto-referencia.md` e o equivalente para `docs/02-playbook-conteudo.md`) — ajuste a URL para o branch/host reais do repositório.
3. No passo 6 (auto-checagem de claims), a rotina não terá `node scripts/claim-check.mjs` disponível — ela deve usar exclusivamente a checagem manual descrita no próprio prompt (lista resumida de padrões proibidos), e confiar na validação de servidor (422) como rede de segurança final.
4. Esta variante é mais frágil (lista de claims proibidas pode ficar desatualizada no prompt colado) — prefira a variante primária sempre que possível.

---

## 4. Guard-rails (obrigatórios, sem exceção)

- **Nunca aprova nem publica.** A rotina só cria peças em status `draft` via `POST /api/pieces`. Aprovação (com upload de imagem) e publicação (cron diário via Graph API) são etapas humanas/automatizadas separadas, fora do escopo desta rotina.
- **Nunca edita código.** A rotina não tem (e não deve ter) permissão de escrita no repositório — nem no produto (`agendatmstudio`), nem no próprio `agendai-social` (nem os docs, nem a UI, nem a API). Ela só lê docs e chama a API HTTP.
- **Aborta se a API estiver inacessível.** Se `GET /api/report/latest` falhar (rede, 5xx, 401 por token errado), a rotina para imediatamente e não gera nenhuma peça — nunca preenche dados de relatório "de memória" ou inventados.
- **Máximo 2 peças por rodada**, salvo override explícito no prompt daquela execução específica (até 4, por `PECAS_POR_RODADA`, playbook §2). A rotina nunca decide sozinha subir esse número.
