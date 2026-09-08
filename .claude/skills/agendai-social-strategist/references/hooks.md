# Fórmulas de hook — aprofundamento

Este arquivo aprofunda as 8 fórmulas de hook da tabela em `SKILL.md` §"Fórmulas
de hook". Os **nomes das fórmulas são idênticos** aos da tabela — não
renomeie nada aqui nem lá. Este documento é referência de apoio: em caso de
conflito com `docs/02-playbook-conteudo.md`, `docs/promessas-proibidas.json`
ou `docs/01-produto-referencia.md`, esses três vencem (regra de precedência
do `SKILL.md`, seção "Regras duras").

Também é vocabulário compartilhado com `/analise-desempenho` (classifica
peças publicadas contra estas 8 fórmulas para montar `hookPatterns`) e
`/analise-mercado` (classifica hooks de concorrentes contra estas 8 fórmulas,
sem nunca copiar a frase deles). Manter os nomes estáveis aqui evita quebrar
a classificação nas outras duas skills.

---

## Regras transversais (valem para as 8 fórmulas)

1. **Hook promete, corpo entrega.** Nunca abra um loop que a legenda não
   fecha. Se o hook diz "3 coisas que sua cliente vê antes de confirmar", o
   desenvolvimento precisa realmente listar as 3 — prometer e não cumprir é
   o motivo nº 1 de um hook virar clickbait.
2. **Teste: a primeira linha funciona sozinha no feed?** O Instagram trunca
   a legenda em ~125 caracteres visíveis antes do "...mais". Leia só essa
   primeira linha, fora de contexto — se ela não faz sentido nem gera
   curiosidade sozinha, reescreva antes de seguir pro corpo.
3. **Especificidade vence vago.** "Sexta às 17h, três mensagens ao mesmo
   tempo" funciona porque é uma cena, não uma categoria. "Gerenciar agenda é
   difícil" não funciona porque não ativa reconhecimento — ninguém se vê
   numa frase genérica. Número concreto, hora do dia, cena do dia a dia >
   adjetivo (difícil/chato/complicado).
4. **1 hook = 1 ideia.** Não empilhe duas fórmulas na mesma linha (ex.: uma
   pergunta que também é uma lista que também é um mito). Escolha uma, e
   deixe a mistura de ângulos para peças diferentes na rotação.

---

## 1. Curiosidade

**Ângulo mobilizado**: curiosidade (principal), às vezes identidade quando o
gatilho é "outro negócio como o seu mudou algo").

**Por que funciona**: explora o *curiosity gap* (efeito Zeigarnik) —
informação incompleta ocupa a atenção até ser resolvida. O cérebro não
gosta de deixar um "loop" aberto; o leitor avança na legenda ou no carrossel
só pra fechar esse loop. Funciona melhor quando o gap é sobre um *processo*
específico (o que mudou, como funciona), nunca sobre um resultado vago
("você não vai acreditar").

**Quando usar**: audiência **fria** (quem ainda não conhece a mecânica) —
é o gancho mais forte pra alcance de não-seguidor. Formatos: Reels (o gap
precisa se resolver nos 3s iniciais e ao longo do vídeo) e carrossel (o
slide 1 abre o gap, os seguintes fecham). Pilares: dor→mecânica, tela
real/bastidores.

**Variações pt-BR**:
- "O que muda quando a barbearia para de anotar horário em papel de
  recado?"
- "Tem um motivo pro link de agendamento da clínica continuar recebendo
  gente enquanto a esteticista atende."
- "Por que a manicure que atende sozinha parou de olhar o celular no meio
  do procedimento?"

**Contra-exemplo**: "Você não vai acreditar no que essa dona de salão
descobriu" — não há referente concreto (qual salão? descobriu o quê?), o
gap não tem stakes reais. Isso é curiosidade vazia — o corpo não tem como
"fechar" um loop que nunca foi realmente aberto, e o leitor se sente
enganado. Curiosidade real nomeia a cena ou o processo; curiosidade vazia
só promete surpresa.

---

## 2. Dor específica

**Ângulo mobilizado**: dor.

**Por que funciona**: aversão à perda — a dor de um problema recorrente
pesa (psicologicamente) mais que o ganho equivalente de resolvê-lo. Somado
à *availability heuristic*: quanto mais vívida e específica a cena (dia da
semana, hora, quantidade), mais real ela parece, e mais fácil o leitor se
reconhece nela — uma dor genérica não ativa esse reconhecimento.

**Quando usar**: audiência **fria** — é o gancho de topo de funil por
excelência, junto com curiosidade e número/lista. Formatos: carrossel
(slide 1) e estático (a dor cabe numa frase de overlay). Pilares:
dor→mecânica, objeção→resposta.

**Variações pt-BR**:
- "Sábado, 14h: você prendendo cílio numa cliente enquanto o celular vibra
  três vezes seguidas."
- "Segunda de manhã: a agenda em caderno com dois nomes escritos no mesmo
  horário, letra por cima da letra."
- "Meio da sessão de limpeza de pele, celular tocando de novo — mais uma
  pergunta de horário que já foi respondida ontem."

**Contra-exemplo**: "Gerenciar um salão é difícil" — dor genérica demais,
sem cena, sem hora, sem quem. Serve pra qualquer negócio do mundo, então
não serve pra nenhum leitor específico. Dor específica precisa doer de um
jeito que só quem já viveu aquela cena exata reconhece na hora.

---

## 3. Número/lista

**Ângulo mobilizado**: curiosidade (gap sobre o que falta na lista) +
comparação implícita ("e você não" / "e um sistema já resolve").

**Por que funciona**: listas reduzem carga cognitiva — o leitor sabe
exatamente o que está prestes a consumir (3 coisas, não um textão) e isso
aumenta a chance de terminar de ler. O número concreto também ativa o
mesmo princípio de especificidade da fórmula 2: "3 coisas" é mais crível e
mais fácil de lembrar do que "algumas coisas".

**Quando usar**: audiência **fria** — funciona bem pra quem não conhece o
produto ainda, porque promete valor educacional sem exigir contexto prévio.
Formato natural: **carrossel** (cada item vira 1 slide, o que também
recompensa quem completa o deslizar — ver seção "Sinais de ranking" do
`SKILL.md`). Pilares: educação de gestão, dor→mecânica.

**Variações pt-BR**:
- "4 perguntas que toda cliente nova faz no WhatsApp antes de marcar — e
  que o link público já responde sozinho."
- "3 decisões que toda dona de salão evita tomar sobre sinal — e uma delas
  pesa toda sexta."
- "2 telas que sua equipe abre sozinha todo dia, sem te ligar pra saber a
  agenda."

**Contra-exemplo**: "5 motivos pelos quais a maioria dos salões perde
dinheiro" — número de itens sem fonte aplicado a uma estatística de
mercado inventada (não está em `docs/01-produto-referencia.md`), o que
viola a regra "sem números de mercado sem fonte" do playbook §3.8. Também
quebra a fórmula se o corpo não entrega os "5 motivos" prometidos — listar
3 e chamar de "5" é o motivo mais comum de clickbait nesta fórmula.

---

## 4. Contraste antes/depois (do processo, nunca do resultado)

**Ângulo mobilizado**: comparação + dor (o "antes" precisa doer de verdade
pro "depois" ter contraste).

**Por que funciona**: mostra uma mudança de estado concreta, o que ativa
tanto o reconhecimento da dor (aversão à perda no "antes") quanto a
resolução (o "depois"). A regra de ouro do produto ("mecânica real, nunca
resultado garantido" — `docs/01-produto-referencia.md` linha 6) exige que
o contraste seja sempre sobre o *processo* (como a cliente marca, como a
mensagem chega) — nunca sobre um resultado de negócio não medido (faturar
mais, agenda cheia).

**Quando usar**: audiência fria a morna — funciona tanto pra quem não
conhece a mecânica (mostra o "antes" que ela reconhece) quanto pra quem já
segue (reforça por que trocou). Formato: carrossel (2 slides, um pra cada
lado do contraste) e estático (dividir o overlay em antes/depois). Pilares:
dor→mecânica, equipe.

**Variações pt-BR**:
- "Antes: cliente ligando pra saber se tem vaga sábado. Depois: ela vendo
  o horário livre sozinha, no link."
- "Antes: cliente contando de novo o que já tinha dito na última sessão.
  Depois: histórico do atendimento já aberto na tela quando ela senta na
  cadeira."
- "Antes: caderno de agendamento com rasura. Depois: agenda no portal,
  cada horário com nome e serviço certos."

**Contra-exemplo**: "Antes: agenda vazia. Depois: lotada." — isso é
contraste de *resultado*, não de processo, e bate direto nas regras
`resultado-garantido` (`agenda cheia` / `agenda lotada`) de
`docs/promessas-proibidas.json`. O claim-check bloqueia esse texto. É o
erro mais fácil de cometer nesta fórmula: trocar "o que muda no dia a dia"
por "quanto você vai vender".

---

## 5. Pergunta direta

**Ângulo mobilizado**: identidade (unity) — a pergunta só funciona se o
"sim" mental do leitor for imediato e específico da tribo dele.

**Por que funciona**: uma pergunta que descreve com precisão uma situação
do dia a dia de quem lê gera um "sim, isso sou eu" silencioso antes mesmo
de continuar a leitura — é reconhecimento de identidade de grupo (fala a
língua de quem já vive aquilo), não uma pergunta retórica genérica.
Funciona melhor em quem **já segue a conta**, porque a pergunta pressupõe
contexto ("sua equipe", "sua recepcionista") que só faz sentido pra quem já
se identifica com o nicho.

**Quando usar**: audiência **quente** — quem já segue reconhece a pergunta
na hora, o que favorece comentário (resposta "sim"/"não" é fácil de
escrever). Formatos: stories (enquete sim/não é a extensão natural da
pergunta) e estático. Pilares: objeção→resposta, equipe.

**Variações pt-BR**:
- "Você ainda é a única pessoa que sabe o que tem marcado pra amanhã no
  seu salão?"
- "Sua recepcionista ainda anota o sinal da cliente numa planilha separada
  da agenda?"
- "Você ainda para o que tá fazendo pra responder 'tem horário sexta?'
  pela quinta vez no dia?"

**Contra-exemplo**: "Você quer ter mais sucesso no seu negócio?" — pergunta
genérica demais, qualquer pessoa responde "sim" sem se reconhecer em nada
específico. Uma pergunta direta que serve pra qualquer negócio do mundo não
mobiliza identidade nenhuma — ela precisa nomear uma situação que só quem
vive o nicho reconhece.

---

## 6. Mito vs realidade

**Ângulo mobilizado**: comparação + curiosidade (a "realidade" corrige uma
crença errada, o que já é uma pequena surpresa).

**Por que funciona**: corrige a *curse of knowledge* — quem nunca geriu
agenda de negócio de serviço carrega crenças desatualizadas ou
superestimadas sobre o que é "coisa de negócio grande" ou "complicado de
configurar". Nomear o mito explicitamente e corrigi-lo com um fato real do
produto reposiciona a crença com autoridade, sem soar arrogante — porque o
mito é validado antes de ser desmontado.

**Quando usar**: audiência **quente** a morna — funciona melhor com quem já
tem alguma familiaridade com o nicho (reconhece o mito citado) do que com
quem nunca ouviu falar do problema. Formatos: carrossel (mito no slide 1,
realidade nos seguintes) e estático (mito riscado, realidade por baixo).
Pilar: educação de gestão.

**Variações pt-BR**:
- "Mito: cobrar sinal antes da sessão afasta cliente novo. Realidade: a
  política de cancelamento aparece pra ela antes de confirmar — ela sabe
  as regras antes de pagar."
- "Mito: fidelidade digital é só pra rede grande de salão. Realidade: o
  carimbo digital tá disponível em todos os planos, mesmo pra quem atende
  sozinha."
- "Mito: agenda online tira o clima de barbearia de bairro. Realidade: o
  link só evita a ligação — quem faz o clima continua sendo você."

**Contra-exemplo**: inventar um "mito" que ninguém realmente acredita só
pra criar um contraste artificial (ex.: "Mito: agendamento online é
ilegal") — isso não corrige crença nenhuma, soa forçado. Também quebra a
fórmula quando a "realidade" promete resultado garantido em vez de
mecânica ("Realidade: sua agenda nunca mais fica vazia") — a correção
precisa continuar dentro da regra de ouro do produto.

---

## 7. Bastidor/POV do dono

**Ângulo mobilizado**: prova social implícita + identidade (unity) — mostra
que "é assim que negócios de verdade funcionam", sem depoimento nem
estatística, só cena real.

**Por que funciona**: combina *mere exposure* (repetição de cenas
reconhecíveis do dia a dia gera familiaridade e confiança) com
*availability heuristic* — uma cena específica e vívida (dia, horário,
ação concreta) parece mais real e mais fácil de imaginar acontecendo com
quem lê do que uma descrição abstrata do produto. Por ser prova social
implícita, qualquer fato citado no POV precisa vir de
`docs/01-produto-referencia.md` — nunca invente um número ou comportamento
de "outros donos" que não esteja documentado.

**Quando usar**: audiência **quente** — funciona melhor pra quem já segue
e reconhece a rotina descrita. Formatos: stories (sequência natural de POV)
e Reels (POV com os personagens LARA/CAMILA/JÚLIA — **só em Reels**, com
descrição verbatim do `01-produto-referencia.md` §8, nunca em
carrossel/estático/stories). Pilares: tela real/bastidores do produto,
equipe.

**Variações pt-BR**:
- "POV: é terça de manhã e você abre o portal só pra ver quem tá na sua
  agenda antes de a primeira cliente chegar."
- "POV: notificação chegou no celular avisando que teve agendamento novo
  enquanto você secava esmalte da última cliente."
- "POV: a recepcionista mostra pro cliente novo a política de cancelamento
  na tela, antes dele confirmar o horário."

**Contra-exemplo**: "POV: um dia normal no salão" — cena genérica demais,
sem hora, sem ação específica, perde o efeito de *availability heuristic*
(não parece nem mais nem menos real que qualquer outro post). Também
descaracteriza a fórmula usar LARA/CAMILA/JÚLIA fora de Reels — a regra do
playbook §3.6 proíbe isso explicitamente, e nesta fórmula é o erro mais
fácil de cometer porque o POV "pede" um rosto.

---

## 8. Erro comum

**Ângulo mobilizado**: dor (aversão à perda) — nomear um erro específico dói
mais do que prometer um acerto, porque ativa o medo de já estar cometendo
aquele erro agora.

**Por que funciona**: mesma base psicológica da aversão à perda da fórmula
2, mas direcionada a uma ação (ou omissão) do próprio leitor, não a uma
situação externa. "Erro comum: X" implica "você pode estar fazendo X agora"
— o que gera um alerta mais forte do que "faça Y para ter sucesso". Precisa
vir sempre acompanhado, no corpo, da mecânica que evita o erro — nunca
apontar o erro e deixar o leitor com a culpa sem solução.

**Quando usar**: audiência morna a quente — funciona bem tanto pra quem já
segue (reconhece o erro na própria rotina) quanto pra quem está decidindo
se troca de processo. Formatos: carrossel (erro no slide 1, mecânica que
evita nos seguintes) e estático. Pilares: educação de gestão, dor→mecânica.

**Variações pt-BR**:
- "Erro comum: deixar a política de cancelamento só na cabeça do dono e
  nunca escrita pra cliente ver."
- "Erro comum: anotar dois clientes no mesmo horário porque a agenda ainda
  tá dividida entre caderno e WhatsApp."
- "Erro comum: vender pacote de sessões e depois perder a conta de quantas
  já foram usadas."

**Contra-exemplo**: "Erro comum: não se importar com seus clientes" — isso
não é um erro específico, é uma acusação vaga e até ofensiva, sem mecânica
nenhuma associada. "Erro comum" só funciona quando nomeia uma ação
concreta e evitável — e o corpo precisa oferecer a mecânica corretiva, não
só apontar a falha e deixar o leitor se sentindo mal.

---

## Nota de validação

As variações pt-BR listadas acima (24 no total, 3 por fórmula) foram
validadas em bloco com `node scripts/claim-check.mjs` e retornaram
`{"ok":true,"violations":[]}`. Os contra-exemplos **não** passam
necessariamente no claim-check de propósito — alguns ilustram exatamente o
tipo de claim que a fórmula pode acidentalmente violar (ex.: o contra-
exemplo da fórmula 4 dispara a regra `resultado-garantido`). Contra-
exemplos nunca devem ser usados como copy real; são material de
treinamento, não de publicação. Ao gerar uma peça nova a partir de uma
variação daqui, rode o claim-check de novo sobre a legenda final completa
(hook + corpo), como exige o checklist do `SKILL.md`.
