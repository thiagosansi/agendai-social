# Edição de copy — 7 passadas

Protocolo de edição (Seven Sweeps, adaptado a legenda de Instagram
pt-BR) para revisar uma legenda **já escrita** antes de rodar o
claim-check. Não é um framework de geração — é uma checagem de qualidade
sobre um rascunho que já segue a estrutura de 7 itens do `SKILL.md`
(hook → desenvolvimento → mecânica real → CTA → hashtags → emoji → tom) e,
opcionalmente, um dos frameworks de `references/legenda.md` (PAS/BAB).

Rode as 7 passadas **em sequência**, uma de cada vez — cada passada olha
para um problema específico; misturar tudo numa leitura só faz o revisor
pular coisa. Em caso de conflito com `docs/02-playbook-conteudo.md`,
`docs/promessas-proibidas.json` ou `docs/01-produto-referencia.md`, esses
três vencem.

---

## As 7 passadas

### 1. Clareza

Leia frase por frase perguntando: um estranho ao assunto entenderia isso
de primeira? Caçar:

- **Frase confusa** — mais de uma leitura possível, ou que exige reler
  pra entender.
- **Referência ambígua** — "ela"/"isso"/"aquilo" sem deixar claro se é a
  cliente, a dona ou o produto.
- **Jargão** — qualquer termo que exige explicação (ver passada 5 e a
  seção "Curse of knowledge" de `references/legenda.md`).

### 2. Voz e tom

Âncora: `docs/01-produto-referencia.md` §7 ("de empreendedor para
empreendedor", curto, no máximo 1 emoji, sem jargão de tecnologia/
marketing). Nesta passada, caçar **oscilação de registro** — a legenda que
começa informal ("Sexta às 17h, correria total") e no meio vira formal
demais ("Nossa solução proporciona uma experiência otimizada de
agendamento") quebra a voz. Escolha um registro (o do playbook: direto,
conversacional, sem forçar gíria) e mantenha do hook ao CTA.

### 3. "E daí?"

Aplicar o teste de `references/legenda.md` frase por frase:

- **Feature sem benefício** — nomeou a mecânica mas não disse o que muda
  pra quem lê. Corrigir com a ponte "ou seja" (ver `references/legenda.md`).
- **Afirmação sem consequência** — frase que descreve algo mas não diz
  por que importa. Cortar ou completar.

### 4. Prova

Todo claim (número, comportamento, benefício) precisa ser rastreável a
`docs/01-produto-referencia.md`. Se não achar a linha/seção correspondente
no documento, **cortar o claim** — não deixar "provavelmente é verdade" ou
"parece razoável" segurar uma frase. Esta passada é a mesma checagem que o
claim-check automatiza para promessas proibidas, mas cobre também claims
que não estão na lista negra e ainda assim não têm fonte (ex.: inventar um
número de clientes atendidos, um prazo, uma métrica que o produto não
mede).

### 5. Especificidade

Caçar os verbos e adjetivos vagos de gestão/marketing e trocar por algo
concreto. Ver a tabela "Cortes word-level" abaixo para os termos mais
comuns — "melhore", "otimize", "transforme" são os três mais frequentes em
rascunho de IA e quase sempre escondem uma cena real que não foi escrita.
Pergunta de checagem: dá pra visualizar isso acontecendo (hora, ação,
lugar)? Se não dá, ainda está vago.

### 6. Emoção

Duas perguntas:

- **A dor do "antes" está viva?** — se a legenda usa PAS/BAB ou qualquer
  hook de dor, o leitor precisa sentir a cena, não só ler a categoria dela
  ("gestão é difícil" não dói; "sexta às 17h com três mensagens ao mesmo
  tempo" dói).
- **A cena do "depois" aparece?** — a mecânica real (item 3 da estrutura)
  não pode ser só uma frase técnica; precisa mostrar a cena do dia a dia
  mudando (ver exemplos completos em `references/legenda.md`).

### 7. Zero fricção pré-CTA

Ler as 1-2 frases imediatamente antes do CTA (item 4 da estrutura) e
perguntar:

- **Existe uma objeção óbvia não respondida ali perto?** (ex.: a legenda
  fala de multi-unidade mas não qualifica o trial antes do CTA — checar
  contra `SKILL.md` §"CTAs").
- **O CTA é coerente com o formato?** — CTA de carrossel/estático no
  último slide/parágrafo; CTA de stories no último frame; nunca um CTA que
  pede ação que o formato não suporta (ex.: "arrasta pra cima" fora de
  stories).

Se alguma objeção ficar sem resposta perto do CTA, resolver ali mesmo (uma
frase curta) ou mover o CTA para depois da frase que resolve.

---

## Regra: máximo 2 passadas completas de reescrita

As 7 passadas acima são **leitura + marcação de problema**, não reescrita
automática. Depois de rodar as 7 e listar os problemas encontrados, aplicar
no máximo **2 passadas completas de reescrita** sobre o texto todo. Passar
da legenda por reescrita completa mais de duas vezes é over-editing — a
voz da legenda começa a ficar genérica e "lavada" a cada rodada extra,
porque cada reescrita suaviza um pouco mais as escolhas específicas que
davam personalidade ao texto. Se depois de 2 passadas de reescrita ainda
sobrar problema, é sinal de que o rascunho original tinha um problema
estrutural (framework errado, hook fraco) — voltar para
`references/legenda.md`, não insistir numa 3ª reescrita de superfície.

---

## Tabela de cortes word-level (pt-BR)

Termos e construções para caçar na passada 5 (Especificidade) e cortar/
trocar antes de considerar a legenda pronta.

| Termo/construção | Ação |
|---|---|
| "muito" / "super" / "extremamente" | Cortar — intensificador sem informação; se a frase precisa de intensidade, mostrar com um fato concreto, não com advérbio. |
| "realmente" / "basicamente" | Cortar — enchimento, a frase funciona igual sem. |
| "a fim de" | Trocar por "para". |
| "solução completa" / "solução robusta" | Trocar por nomear a feature exata (ex.: "link público + sinal via Stripe + portal da equipe"). |
| "inovador" / "revolucionário" | Cortar — mostrar o que a feature faz em vez de adjetivá-la. |
| "otimize" (verbo vago) | Trocar por um verbo concreto do que o produto faz ("mostra", "calcula", "organiza", "avisa"). |
| "venha conhecer" / "clique aqui" | Trocar pelo CTA padrão do `SKILL.md` §"CTAs" — nunca inventar variação nova de CTA. |
| "estaremos enviando" / "estaremos disponibilizando" (gerúndio burocrático) | Trocar por presente direto: "enviamos", "disponibilizamos" — ou, melhor, nomear quem faz a ação ("você configura", "a cliente vê"). |
| Voz passiva ("o agendamento é confirmado pelo sistema") | Trocar por voz ativa, nomeando quem faz ("você confirma o agendamento" / "a cliente confirma sozinha"). |
| "coisas" ("várias coisas mudam com o Agendaí") | Nomear exatamente o quê — se não dá pra nomear, a frase provavelmente não devia estar na legenda. |
| "ferramenta" / "plataforma" (referência genérica ao produto) | Trocar por "Agendaí" ou pela feature específica — referência genérica ao próprio produto soa institucional, quebra o tom "de empreendedor para empreendedor". |
| "fácil" / "simples" (sozinho, sem mostrar o quê) | Trocar por mostrar a ação simples de verdade ("configura sozinha, sem precisar de desenvolvedor" — fato de `docs/01-produto-referencia.md` §1). |

---

## Ver também

- `references/legenda.md` — frameworks PAS/BAB, ponte "ou seja", teste "e
  daí?", especificidade e escaneabilidade na hora de **escrever** a
  legenda (este arquivo cobre a passada de **revisão** depois de escrita).
- `references/hooks.md` — fórmulas de hook (item 1 da estrutura).
- `SKILL.md` §"Checklist final antes de entregar" — onde a passada de
  edição (este arquivo) entra como item obrigatório antes do claim-check.
