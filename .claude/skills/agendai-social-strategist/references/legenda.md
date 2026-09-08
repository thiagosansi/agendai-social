# Frameworks de body copy — aprofundamento

Este arquivo aprofunda a seção `## Estrutura de legenda` do `SKILL.md`. Ele
**não redefine** a estrutura de 7 itens (hook → desenvolvimento → mecânica
real → CTA → hashtags → emoji → tom) — mapeia dois frameworks clássicos de
copy (PAS e BAB) **em cima** dela, e dá as regras de qualidade de frase que
valem para qualquer legenda, independente do framework escolhido.

Vocabulário de hook (as 8 fórmulas) já está documentado em
`references/hooks.md` — este arquivo não duplica aquele conteúdo, só o
referencia onde o framework toca o item 1 (Hook) da estrutura.

Em caso de conflito com `docs/02-playbook-conteudo.md`,
`docs/promessas-proibidas.json` ou `docs/01-produto-referencia.md`, esses
três vencem (regra de precedência do `SKILL.md`, seção "Regras duras").

---

## PAS (Problema → Agitação → Solução)

Framework de topo de funil: nomeia o problema, deixa a dor esticar um
pouco (sem exagerar pra virar drama), depois entrega a mecânica que
resolve. Funciona melhor com audiência **fria** — mesma lógica de
temperatura descrita no `SKILL.md` §"Fórmulas de hook".

### Mapeamento na estrutura existente

| Etapa PAS | Ocupa qual item da estrutura | O que fazer |
|---|---|---|
| **P — Problema** | Item 1 (Hook) + início do item 2 (Desenvolvimento) | Nomear a dor específica, com cena (dia/hora/ação) — use a fórmula "Dor específica" ou "Pergunta direta" de `references/hooks.md`. |
| **A — Agitação** | Resto do item 2 (Desenvolvimento) | 1-2 frases que mostram a *consequência* de não resolver o problema (o que a dona perde: tempo, foco no atendimento, fim de semana). Nunca inventar estatística — a agitação vem da cena, não de número de mercado. |
| **S — Solução** | Item 3 (Mecânica real) | A feature exata que resolve, com a ponte "ou seja" (ver seção abaixo) explicando o benefício concreto. |
| — | Itens 4-7 (CTA, hashtags, emoji, tom) | Sem mudança — seguem a estrutura padrão. |

**Regra da Agitação**: ela precisa esticar a dor com uma *consequência
real e permitida* (tempo perdido, interrupção do atendimento, mensagem
acumulada) — nunca com estatística inventada ("70% dos donos perdem
clientes") nem com resultado de negócio garantido ("agenda vazia"). Se a
agitação não sobrevive ao teste "e daí?" (seção abaixo), ela é drama vazio,
não PAS.

### Exemplo completo (passa em `node scripts/claim-check.mjs`)

Pilar dor→mecânica, segmento clínica de estética:

```
Sexta às 17h: três mensagens chegando ao mesmo tempo pedindo horário — e você no meio de um procedimento.

Você não larga a cliente pra responder. Aí ou demora e a outra desiste, ou marca de cabeça e bate horário com quem já tinha marcado. Sobra pra você resolver isso depois, no fim do expediente.

Com o link público do Agendaí, a cliente marca sozinha, direto no navegador, sem esperar você largar o procedimento pra responder — ou seja, menos mensagem acumulada pra resolver depois do expediente.

agendai.space — 30 dias grátis, sem cartão.

#agendaí #clínicadeestética #esteticista #agendamentoonline #gestãodenegócio #donadenegócio
```

Output real de `node scripts/claim-check.mjs --text "<legenda acima>"`:
`{"ok":true,"violations":[]}`.

---

## BAB (Antes → Depois → Ponte)

Framework de contraste: mostra o estado antigo, o estado novo, e a ponte
que liga um ao outro (a mecânica do produto). É primo do "Contraste
antes/depois" listado em `references/hooks.md` — mas ali é só o hook (item
1); aqui o contraste organiza a legenda inteira.

### Mapeamento na estrutura existente

| Etapa BAB | Ocupa qual item da estrutura | O que fazer |
|---|---|---|
| **A — Antes** | Item 1 (Hook) | Cena do processo antigo — nunca do resultado ("agenda vazia" é proibido). Sempre sobre o *processo* (como a cliente marcava, como a mensagem chegava). |
| **B — Depois** | Item 2 (Desenvolvimento) | O novo processo, ainda sem nomear a feature — descreve a mudança do ponto de vista de quem vive ela (dona ou cliente final). |
| **Ponte** | Item 3 (Mecânica real) | Nomeia a feature exata que liga Antes→Depois, sempre fechando com "ou seja" + benefício concreto (ver seção abaixo). É a ponte que prova que o Depois não é wishful thinking — é mecânica real e verificável em `docs/01-produto-referencia.md`. |
| — | Itens 4-7 (CTA, hashtags, emoji, tom) | Sem mudança. |

**Regra do Antes/Depois**: assim como no contraste de hook, o Antes/Depois
do BAB é sempre sobre o **processo**, nunca sobre resultado de negócio não
medido. "Antes: agenda vazia. Depois: lotada" viola `resultado-garantido`
em `docs/promessas-proibidas.json` e o claim-check bloqueia.

### Exemplo completo (passa em `node scripts/claim-check.mjs`)

Pilar cliente final, segmento studio de unha/cílio/sobrancelha:

```
Antes: cliente ligando pra saber se tem horário sábado, e você parando a manicure que já tá fazendo pra checar a agenda de papel.

Depois: ela vê o horário livre sozinha, direto no link público — sem te tirar do que você tá fazendo com quem já tá na cadeira.

A ponte é o link público do Agendaí: ele mostra só os horários realmente disponíveis, com o intervalo entre atendimentos já configurado por você. Ou seja, menos interrupção no meio do procedimento, mais foco em quem já chegou.

agendai.space — 30 dias grátis, sem cartão.

#studiodeunhas #cílios #sobrancelhas #autônoma #agendamentoonline #gestãodenegócio
```

Output real de `node scripts/claim-check.mjs --text "<legenda acima>"`:
`{"ok":true,"violations":[]}`.

---

## Ponte "ou seja..." (obrigatória para toda feature)

Toda vez que a legenda menciona uma feature do produto, ela precisa vir
seguida do benefício concreto, amarrado com "ou seja" (ou equivalente:
"isso significa", "na prática"). Feature sem ponte é jargão de produto —
a leitora não gerencia SaaS, ela gerencia um salão.

- **Errado** (feature solta, sem ponte): "O Agendaí tem link público de
  agendamento com política de cancelamento configurável."
- **Certo** (feature + ponte): "O Agendaí tem link público de agendamento
  com política de cancelamento visível antes de confirmar — ou seja, a
  cliente já sabe as regras antes de marcar, e você não precisa explicar
  de novo no direct."

A ponte precisa terminar numa consequência que a leitora reconhece no
próprio dia a dia (menos mensagem, menos interrupção, menos dúvida
repetida) — nunca numa abstração ("otimiza sua gestão", "melhora sua
rotina"). Ver seção "Especificidade" abaixo.

---

## Teste "e daí?" (por frase)

Depois de escrever cada frase da legenda, pergunte: **e daí?** — ou seja,
"por que isso importa pra quem lê?". Se a frase não sobrevive à pergunta,
duas saídas:

1. **Cortar** — a frase não carregava informação nova nem consequência,
   era só enchimento.
2. **Completar** — adicionar a consequência que faltava (geralmente com a
   ponte "ou seja" acima).

Exemplo de frase que falha o teste: "O Agendaí facilita a gestão do seu
negócio." *E daí?* — não diz o quê muda no dia a dia. Reescrita que passa:
"O Agendaí mostra, num só lugar, quem confirmou e quem só marcou — ou
seja, você não precisa abrir o WhatsApp pra saber quem realmente vem."

Isso vale tanto para frases de "Desenvolvimento" (item 2) quanto para a
"Mecânica real" (item 3) — os dois blocos onde a legenda mais escorrega
para abstração.

---

## Especificidade (números concretos e cenas reais)

Prefira sempre uma cena específica do dia da profissional a uma
abstração de gestão. A regra é a mesma do `references/hooks.md`
(princípio 3, "Especificidade vence vago"), aplicada ao corpo inteiro da
legenda, não só ao hook.

| Abstrato (evitar) | Específico (usar) |
|---|---|
| "otimize sua gestão" | "agenda das 19h sem ninguém pra confirmar quem vem" |
| "melhore o atendimento" | "cliente que some depois de marcar e nunca mais responde" |
| "ganhe tempo" | "domingo de noite respondendo mensagem de horário pra segunda" |
| "muitas mensagens" | "três mensagens ao mesmo tempo, sexta às 17h" |
| "vários clientes esquecem" | "cliente que confirma e não aparece, sem avisar" |

**Números redondos vs. específicos**: um número redondo ("10 clientes por
dia") soa arredondado/genérico; um número específico e crível ("3
mensagens ao mesmo tempo", "2 horários no mesmo slot") soa observado, não
inventado — e mais importante: só usar número que vem de
`docs/01-produto-referencia.md` ou de uma cena plausível do dia a dia,
nunca estatística de mercado sem fonte (regra 8 do playbook §3, já coberta
pelo claim-check).

---

## Escaneabilidade

- **1 ideia por peça.** Não misture dois pilares ou duas features
  protagonistas na mesma legenda — isso é papel da rotação (playbook §2),
  não de empilhar tudo numa peça só.
- **Frases de no máximo ~25 palavras.** Frase mais longa que isso quase
  sempre está fundindo duas ideias — quebre em duas frases.
- **Quebra de linha entre blocos.** Cada item da estrutura (hook,
  desenvolvimento, mecânica, CTA) fica em seu próprio parágrafo, separado
  por linha em branco — igual aos três exemplos completos do `SKILL.md`.
  Facilita ler em tela de celular sem parecer parede de texto.
- **Primeira frase de cada bloco tem que ser forte.** Não só o hook (item
  1) — a primeira frase do "Desenvolvimento" e da "Mecânica real" também
  precisam segurar a atenção sozinhas, porque é o que aparece quando o
  layout do carrossel/estático mostra só a linha de cima de cada bloco.

---

## Psicologia permitida (com limites explícitos)

Estes gatilhos são permitidos, mas cada um tem uma cerca clara — ultrapassar
a cerca é o motivo mais comum de uma legenda soar manipuladora ou violar o
claim-check.

- **Aversão à perda ligada a dor real.** Pode explorar a dor de perder
  tempo/foco/horário (no-show, horário vago, tempo perdido no WhatsApp) —
  mas **sem inventar estatística** de quanto isso custa. "Cada mensagem
  sem resposta é um horário que podia estar ocupado" é permitido; "você
  perde R$ 500 por mês em faltas" não é (regra `valor-perdido-mes` do
  claim-check).
- **Prova social apenas com fatos documentados.** Só cite comportamento de
  "outros donos"/"outras clientes" se o fato estiver em
  `docs/01-produto-referencia.md` (ex.: mecânica que existe e é usada por
  todos os planos). Nunca invente depoimento, número de usuários ou
  "milhares de salões já usam" — isso não está documentado e não passa na
  regra de fonte do playbook §3.8.
- **Reciprocidade.** Entregar valor real na legenda (uma explicação útil,
  um jeito de pensar sobre política de cancelamento, uma mecânica que a
  leitora pode aplicar mesmo sem assinar) **antes** do CTA — não fazer da
  legenda um teaser vazio que só empurra pro link.
- **Curse of knowledge — zero jargão de gestão/SaaS.** A leitora é dona de
  salão/spa/clínica/studio, não gestora de tráfego nem PM de produto.
  Nunca usar "onboarding", "funil", "conversão", "churn", "growth",
  "stack", "workflow", "otimizar" como verbo vago, "solução robusta",
  "ecossistema". Se a frase soa como pitch de investidor, reescreva com a
  palavra que a própria dona usaria no balcão.

---

## Ver também

- `references/hooks.md` — as 8 fórmulas de hook (item 1 da estrutura),
  com princípio psicológico, uso por temperatura de audiência e
  contra-exemplos.
- `references/edicao-copy.md` — protocolo de edição em 7 passadas e
  tabela de cortes word-level, para revisar uma legenda já escrita antes
  do claim-check.
