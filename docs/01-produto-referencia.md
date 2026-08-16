# Produto de referência — Agendaí (para conteúdo de Instagram)

**Última atualização**: 2026-08-16
**Propósito**: esta é a fonte única de verdade que um agente de IA deve ler a cada rodada antes de criar posts/Reels de Instagram para o Agendaí. Nenhum benefício, número ou funcionalidade deve ser citado em conteúdo se não estiver neste documento.

**Regra de ouro**: mecânica real, nunca resultado garantido. Fale do que o produto *faz* (link público, sinal via Stripe, portal da equipe), nunca de resultado de negócio que o produto não mede ou não garante ("agenda cheia", "reduz faltas em X%", "fatura mais"). Já houve claims falsas publicadas na landing que precisaram de hotfix — este doc existe para não repetir o erro.

**Documentos ligados**:
- `docs/instagram/promessas-proibidas.json` — lista estruturada de promessas banidas + substitutas (gerado por outra task).
- `docs/instagram/02-playbook-conteudo.md` — como transformar este inventário em posts/roteiros.

---

## 1. Quem é o Agendaí (5 linhas)

O Agendaí é um sistema de agendamento online para pequenos e médios estabelecimentos de serviços no Brasil (salões, barbearias, clínicas, spas, estúdios). O cliente final agenda pelo link público do estabelecimento, direto no navegador — sem baixar app, sem criar conta. O dono configura tudo sozinho, sem precisar de desenvolvedor. Os sinais de agendamento vão direto para a conta do estabelecimento via Stripe Connect — o Agendaí não cobra comissão por transação e não fica no meio do fluxo financeiro. Não existe marketplace nem diretório de busca: cada estabelecimento tem sua própria URL e mantém o relacionamento direto com o cliente; os dados (histórico, clientes, agendamentos) são do estabelecimento, exportáveis em CSV.

Fonte: `docs/identidade.md`.

---

## 2. Público e dores

### Por segmento (fonte: `docs/outreach-whatsapp.md`, seções "Dores")

| Segmento | Dores específicas |
|---|---|
| Spas | Sessão longa e cara (massagem, dia de spa) — no-show dói mais financeiramente; dono/terapeuta com as mãos ocupadas demora a confirmar no WhatsApp e a cliente desiste; agenda em caderno ou conversa solta permite bater dois horários; sinal costuma ser cobrado "no fiado" ou nem é cobrado. |
| Studios de unha/cílio/sobrancelha | Volume alto de mensagens sexta/sábado à tarde — no meio da correria alguém marca em cima de outra cliente; ticket menor mas volume maior, tempo perdido combinando horário se multiplica; no-show no horário nobre de sexta/sábado não é reaproveitável; cliente quer marcar fora do expediente (domingo à noite) e só consegue segunda de manhã; encaixe/remarcação manual constante para quem atende sozinha. |

### Dor estrutural do mercado (fonte: `docs/identidade.md`)

88% dos salões brasileiros usam WhatsApp como método principal de agendamento → agenda caótica: mensagens perdidas, sem histórico, sem confirmação automática, sem controle de horário; dono passa horas por dia respondendo manualmente o que poderia ser automático.

### Dores do cliente final

- Espera resposta no WhatsApp para saber se o horário está livre.
- Quer marcar fora do expediente (domingo à noite, feriado) e não consegue.
- Não sabe a política de cancelamento antes de marcar (fica na dúvida se perde o sinal).

---

## 3. Tabela principal por área

> Colunas: **Feature | Como funciona (mecânica real) | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência**

### Agendamento público

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Link público de agendamento | Wizard de 6 passos em `/agendar/[slug]`, direto no navegador, sem app/conta | Cliente esperando resposta no WhatsApp | Reduz troca de mensagens para marcar horário | Cliente marca domingo 23h sem esperar ninguém responder | Todos | `components/booking/BookingWizardPublic.tsx:214` |
| Sinal pago via Stripe Connect | % configurável (padrão 30%) só em serviços com "Exigir sinal"; serviços de avaliação nunca cobram sinal | Cancelamento em cima da hora sem custo pra quem furou | Sinal reduz o incentivo de faltar sem avisar (mecânica, não estatística) | Sabe de antemão quanto vai pagar de sinal | Todos | `lib/plan-guard.ts:156-166` (canUsePayments), `prisma/schema.prisma:315` (requiresDeposit) |
| "Coberto pelo seu pacote" | No wizard, se o cliente tem sessões de pacote ativas, o sistema mostra que o atendimento já está pago | Cliente esquece quantas sessões já pagou | Menos cobrança manual repetida | Vê na hora que não precisa pagar de novo | Todos | `BookingWizardPublic.tsx:890,909` |
| Política de cancelamento visível | Texto livre configurável pelo dono, exibido ao cliente antes de confirmar; reembolso automático do sinal por faixas de prazo | Cliente não sabe as regras antes de marcar | Menos dúvida/reclamação pós-cancelamento | Sabe as regras antes de confirmar | Todos | `prisma/schema.prisma:183-185`, `BookingWizardPublic.tsx:681-698` |
| Área do cliente sem senha | `/agendar/[slug]/conta/[token]` — acesso por token, ver/cancelar agendamentos | Cliente precisa falar com o estabelecimento pra ver ou cancelar | Menos mensagem pedindo pra remarcar/cancelar | Resolve sozinho, sem criar conta | Todos | `lib/plan-guard.ts:109-119` (canUseClientPortal) |
| Avaliação pós-atendimento | Nota de 1 a 5 estrelas preenchida pelo cliente após o atendimento, no próprio link | Feedback informal se perde em conversa de WhatsApp | Histórico de avaliação centralizado | Dá feedback em segundos | Todos | `app/api/public/[slug]/review/route.ts`, model `EstablishmentReview` |
| Serviço em grupo | `maxParticipants` define quantas pessoas cabem no mesmo horário (ex. aula em grupo) | Agendar aula/turma manualmente um a um | Preenche vaga de turma sem controle manual | Marca vaga em aula em grupo pelo link | Todos | `prisma/schema.prisma:313` |
| Serviço de avaliação | `requiresEvaluation` — preço definido só depois da avaliação presencial, nunca cobra sinal | Precificar serviço que depende de avaliação técnica | Evita cobrar sinal de valor incerto | Marca sem se comprometer com preço fechado | Todos | `prisma/schema.prisma:314` |
| Promoções por dia/horário | Desconto percentual configurável por dia da semana e período | Precisar avisar promoção manualmente | Preenche horário de baixo movimento sem esforço manual | Vê o desconto já aplicado no link | Todos | `prisma/schema.prisma:319-324` |
| Link "adicionar ao Google Calendar" | Gera link de evento único para o cliente adicionar manualmente ao calendário dele | Cliente esquece o horário marcado | — | Não depende de anotar em outro lugar | Todos | `BookingWizardPublic.tsx:121-140` — **não é sincronização**, é link de evento único |

### Gestão de agenda

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Agendamento manual | Dono/equipe cria agendamento direto no dashboard ou no portal da equipe | Cliente que só liga ou manda mensagem | Centraliza toda a agenda num só lugar, mesmo o que veio por fora | — | Todos | dashboard + portal da equipe |
| Walk-in | Registro de atendimento sem agendamento prévio, configurável por `allowWalkIn` | Cliente que chega sem marcar | Não perde o registro do atendimento espontâneo | — | Todos | `prisma/schema.prisma:458-463` (enum `walk_in`), config `allowWalkIn` |
| Status de agendamento | pending / pending_payment / confirmed / completed / cancelled / no_show | Confundir o que já foi confirmado com o que não foi | Visão clara do funil de cada horário | — | Todos | enum `AppointmentStatus` |
| Bloqueios e folgas | Bloqueio manual por profissional (férias, pausa), exceções recorrentes anuais (feriados) | Marcar em cima de folga ou feriado | Evita agendamento em dia que não vai atender | — | Todos | `prisma/schema.prisma:361-410` |
| Buffer, antecedência, intervalo de slots | Intervalo entre atendimentos, antecedência mínima/máxima pra marcar, granularidade dos horários (30/60min) | Agendamentos colados sem tempo de preparo | Controla o ritmo real do atendimento | Só vê horários realmente disponíveis | Todos | `prisma/schema.prisma:180-199` (`TenantSettings`) |
| Confirmação manual opt-in | Dono pode exigir confirmação manual antes do agendamento virar "confirmado" | Agendamento automático demais para negócio que prefere revisar | Controle final antes de comprometer a agenda | — | Todos | `confirmationRequired` em `TenantSettings` |
| Extras no atendimento | Serviço extra adicionado durante o atendimento, com preço travado no momento | Renegociar preço depois do atendimento feito | Registra upsell sem perder o preço combinado | — | Todos | `prisma/schema.prisma:530-546` (`AppointmentExtra`) |
| Marcação de atraso | Campo `lateAt` registra atraso do cliente no atendimento | Perder o controle de pontualidade dos clientes | Histórico de pontualidade por cliente | — | Todos | campo `lateAt` |

### Equipe & profissionais

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Portal da Equipe | `/equipe/[slug]`, login por PIN de 4-6 dígitos, sessão em cookie assinado por 24h | Profissional sem acesso próprio à agenda, dependendo do dono | Cada profissional entra sozinho, sem senha de e-mail | — | Todos | `lib/pro-auth.ts:5-38` |
| Sub-áreas do portal | Agenda, clientes, disponibilidade, equipe, relatório, serviços | Profissional preso a um único painel genérico | Cada papel vê só o que precisa | — | Todos por papel | `app/equipe/[slug]/*` |
| Gestão de equipe restrita | Cadastro/edição de profissionais só para owner/manager | Qualquer profissional mexendo no cadastro de outro | Controle de quem entra e sai da equipe | — | Todos | `app/equipe/[slug]/equipe/page.tsx:11,27` |
| 4 papéis com permissões configuráveis | owner / manager / professional / receptionist; auto-gestão de disponibilidade, agendamento manual, ver histórico configuráveis por papel | Dar acesso total a quem só precisa ver a própria agenda | Controle fino de quem faz o quê | — | Todos | `TenantSettings` (allowStaff*) |
| Comissão por profissional | % base com override por serviço; valor travado na conclusão do atendimento; payouts/ajustes manuais | Calcular comissão manualmente no fim do mês | Comissão calculada automaticamente por atendimento concluído | — | **Professional/Business** | `lib/plan-guard.ts:140-150` (`canUseCommissions`) |
| Notificação web push | Dono e profissionais recebem push no navegador/PWA | Não saber na hora que um agendamento novo entrou | Fica sabendo sem checar o painel toda hora | — | Todos | `prisma/schema.prisma:766-780` (`PushSubscription`) |

### Clientes & retenção

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Anamnese digital | Ficha com termo de consentimento LGPD, preenchida **pelo profissional** (não pelo cliente no link público) | Ficha de papel perdida ou desatualizada | Ficha sempre à mão antes do atendimento | — | **Professional/Business** | `lib/plan-guard.ts:124-134` (`canUseAnamnesis`) — cliente NÃO preenche a própria anamnese |
| Pacotes de sessões | Venda presencial (dinheiro/pix/cartão registrados manualmente), consumo automático de 1 sessão por atendimento concluído, reversão em cancelamento | Controlar manualmente quantas sessões restam de um pacote fechado | Consumo e reversão automáticos, sem planilha à parte | Não precisa lembrar quantas sessões ainda tem | Todos | `prisma/schema.prisma:786-844`, `app/dashboard/clients/package-actions.ts:7-9` |
| Fidelidade digital | Carimbo digital por atendimento concluído, meta configurável, resgate automático ao bater a meta | Cartão de papel perdido ou esquecido | Retenção sem controle manual de carimbo | Não perde o cartão de papel | Todos | `prisma/schema.prisma:693-752` — sem gate de plano em `lib/plan-guard.ts` |
| Histórico + anotações internas | Registro de atendimentos e observações do profissional por cliente | Depender da memória de quem atendeu da última vez | Continuidade de atendimento mesmo trocando profissional | — | Todos | modelos `Appointment`, `AppointmentNote` |
| Arquivamento (soft delete) | Cliente pode ser arquivado sem apagar histórico | Base de clientes poluída com quem não volta mais | Lista limpa sem perder dado histórico | — | Todos | soft delete em `Client` |
| Import/export CSV | Clientes e serviços importáveis/exportáveis em CSV | Migrar de planilha ou de outro sistema manualmente | Começa com a base já pronta; dado nunca fica preso na plataforma | — | Todos | `lib/csv.ts`, `lib/import-clients.ts` |
| Short link por cliente | `/c/[code]` — link curto individual por cliente | — | Facilita compartilhar link específico | Acesso rápido sem digitar nada | Todos | rota `/c/[code]` |

### Pagamentos

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Stripe Connect Express | Estabelecimento é merchant of record; sinal cai direto na conta do estabelecimento; Agendaí não cobra comissão por transação (taxa de processamento da Stripe existe e é do estabelecimento) | Intermediário no recebimento / taxa por agendamento | Recebe direto, sem esperar repasse | Paga direto pela plataforma de confiança da Stripe | Todos | `docs/identidade.md` — "Direto ao recebimento" |
| Reembolso do sinal | Automático dentro do prazo configurado, ou manual pelo botão no dashboard | Devolver sinal manualmente por fora | Menos trabalho operacional em cancelamento | Recebe o reembolso sem pedir | Todos | `lib/booking-payments.ts` (`calculateDepositAmount`, `stripe.refunds.create`) |
| Forma de pagamento na conclusão | Rótulo manual (dinheiro/pix/cartão) registrado ao concluir o atendimento — **não processa Pix real** | Não saber depois como cada atendimento foi pago | Relatório de faturamento por forma de pagamento | — | Todos (config `requirePaymentMethod`) | apenas rótulo, não gateway |
| Vaga extra de profissional | Add-on pago na própria assinatura para adicionar profissional além do limite do plano | Precisar trocar de plano só por causa de 1 profissional a mais | Cresce a equipe sem trocar de plano inteiro | — | Todos | `app/api/dashboard/extra-staff/route.ts` |

### Comunicação

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| E-mail de confirmação ao cliente | Enviado ao cliente ao confirmar agendamento | Cliente sem confirmação por escrito do horário | — | Tem confirmação por e-mail do horário marcado | **Só Business pago (nem trial inclui)** | `lib/plan-guard.ts:189-199` (`canUseBookingConfirmationEmails`) — status precisa ser `active`/`past_due`, trialing NÃO conta |
| E-mail de boas-vindas/encerramento | Enviado automaticamente no cadastro do estabelecimento e no encerramento de conta | — | Comunicação institucional automática | — | Todos | sempre ativo, não é feature de plano |
| WhatsApp click-to-send | Botão que abre `wa.me` com mensagem pré-preenchida (confirmação, agradecimento, resgate de fidelidade) — o Agendaí não dispara nada sozinho | Digitar a mensagem toda vez manualmente | Mensagem pronta, só confirmar o envio | Recebe mensagem no canal que já usa | Todos (mensagem padrão) | template **custom**: `lib/plan-guard.ts:172-182` (`canUseCustomWhatsappMessage`) — Professional/Business; `app/page.tsx:1653-1720` confirma "não dispara nada sozinho" |
| Divulgação por canal | `/dashboard/divulgar` gera 3 links curtos (Google Perfil da Empresa, Instagram, WhatsApp) com origem estimada do agendamento | Não saber de onde vêm os agendamentos | Enxerga qual canal traz mais gente sem ferramenta de analytics externa | — | Todos | rota `/dashboard/divulgar` |
| AgendaIA | Chat que responde perguntas sobre os próprios dados do estabelecimento (agenda, clientes, faturamento) | Levantar número manualmente pra responder pergunta simples | Resposta rápida sobre o próprio negócio, sem abrir relatório | — | **Business** | `components/dashboard/AiChat.tsx:45` |
| Perguntaí | Chatbot da landing pública que responde dúvidas sobre o Agendaí | Visitante sem resposta rápida na landing | — | Tira dúvida sem esperar atendimento humano | N/A (marketing) | landing pública |

### Relatórios & dados

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Relatório de gestão | Faturamento líquido, ticket médio, desempenho por profissional, pacotes, avaliações, comparação com período anterior | Fechar o mês sem saber os números reais | Visão financeira sem planilha manual | — | Todos | `app/dashboard/reports/page.tsx` |
| Relatório por profissional | Desempenho individual visível no portal da equipe | Profissional sem visibilidade do próprio desempenho | — | — | Todos, escopado por papel | portal da equipe |
| Relatório de comissões | Detalha comissão calculada por profissional/período | Conferir comissão manualmente | Fecha comissão sem planilha à parte | — | **Professional/Business** | segue gate de `canUseCommissions` |

> **Sem export CSV de relatórios** — só clientes/serviços têm export CSV (ver seção Clientes & retenção).

### Configuração & marca

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| 9 temas visuais | Link público troca de identidade visual por tema pré-configurado | Link genérico sem cara do negócio | Link com a identidade do estabelecimento, sem precisar de designer | Reconhece o estabelecimento pela cor/estilo | Todos | `lib/themes.ts` |
| PWA instalável | Instalável na tela inicial do celular via navegador — **não é app de loja** | Depender de abrir o navegador toda vez | Atalho rápido pro dashboard | Atalho rápido pro link de agendamento | Todos | PWA, sem publicação em App Store/Play Store |
| Categorias de serviço com foto | Serviços organizados por categoria com imagem | Lista de serviço só em texto corrido | Link mais visual e fácil de navegar | Encontra o serviço mais rápido | Todos | modelo `ServiceCategory` |
| Encerramento de conta com carência | Conta encerrada com carência de 30 dias (LGPD) antes de exclusão definitiva | Medo de perder tudo ao cancelar por engano | Tempo de reconsiderar antes da exclusão definitiva | — | Todos | fluxo LGPD de encerramento |

### Multi-unidade

| Feature | Como funciona | Dor que resolve | Benefício p/ estabelecimento | Benefício p/ cliente final | Plano | Ressalvas / evidência |
|---|---|---|---|---|---|---|
| Múltiplos estabelecimentos, 1 login | `TenantSwitcher` troca entre estabelecimentos via cookie `active_tenant_id` | Gerenciar 2+ unidades com logins separados | Um único login pra tocar todas as unidades | — | Todos (unidade adicional sem trial, preço cheio) | `app/onboarding/actions.ts:100-151` — trial de 30 dias vale só para o 1º estabelecimento do dono |

---

## 4. Planos & preços

| Plano | Preço | Limite de profissionais | Trial |
|---|---|---|---|
| Starter | R$ 29,90/mês | 2 | — |
| Professional | R$ 99,90/mês | 11 | 30 dias grátis, sem cartão — **só no 1º estabelecimento do dono** |
| Business | R$ 197,90/mês | 25 | 30 dias grátis, sem cartão — **só no 1º estabelecimento do dono** |

Fonte: `prisma/seed.ts`. Todo tenant novo começa com trial de 30 dias do plano Professional; unidade adicional do mesmo dono pula direto para `trial_expired` (`app/onboarding/actions.ts:100-151`).

**Cota mensal de agendamentos está desativada no código** (`lib/plan-guard.ts:74-78`, `canAddAppointment` sempre retorna `true`) — **nunca divulgar limite de agendamentos como diferencial ou bloqueio de plano.**

### Gates de plano confirmados em `lib/plan-guard.ts`

| Feature | Gate | Planos liberados |
|---|---|---|
| Anamnese digital | `canUseAnamnesis` (linhas 124-134) | Professional, Business |
| Comissões | `canUseCommissions` (linhas 140-150) | Professional, Business |
| Mensagem WhatsApp custom | `canUseCustomWhatsappMessage` (linhas 172-182) | Professional, Business |
| E-mail de confirmação ao cliente | `canUseBookingConfirmationEmails` (linhas 189-199) | **Business pago apenas** — trialing não conta |
| AgendaIA | checagem em `components/dashboard/AiChat.tsx:45` | Business |
| Sinal via Stripe | `canUsePayments` (linhas 156-166) | Todos os planos |
| Área do cliente | `canUseClientPortal` (linhas 109-119) | Todos os planos |
| Fidelidade | sem gate no arquivo | Todos os planos |
| Pacotes | sem gate no arquivo | Todos os planos |
| Divulgação por canal | sem gate no arquivo | Todos os planos |
| Portal da equipe | sem gate no arquivo | Todos os planos |

---

## 5. NÃO existe / está DESLIGADO

Nunca prometer nada desta lista em conteúdo.

| # | Item | Situação real |
|---|---|---|
| 1 | Lembrete automático por e-mail | Código existe no repositório, mas o cron que dispararia foi removido em produção no commit `1ce95d4`. Não roda hoje. |
| 2 | E-mail de novo agendamento ao dono | Removido no mesmo commit `1ce95d4`. |
| 3 | Pix real | Não existe processamento de Pix. Só existe o **rótulo manual** "pix" como forma de pagamento registrada ao concluir atendimento ou vender pacote presencialmente (dinheiro/pix/cartão são só etiquetas, não gateways). |
| 4 | WhatsApp automático | Não existe disparo automatizado. Só existe botão click-to-send que abre `wa.me` com mensagem pré-preenchida — o dono precisa clicar em "enviar" manualmente. |
| 5 | Reserve with Google | Não existe integração. |
| 6 | Botão "Reservar" do Instagram | Não existe integração nativa; o que existe é o link público compartilhável manualmente. |
| 7 | Sincronização com Google Calendar | Não existe sync bidirecional. Só existe link "adicionar evento" que o cliente clica manualmente, uma vez, no momento do agendamento. |
| 8 | Cupons para cliente final | Não existe sistema de cupom de desconto para o cliente final. |
| 9 | Lista de espera | Não existe. |
| 10 | App nativo | Não existe app em loja (App Store/Play Store). Só existe PWA instalável pelo navegador. |
| 11 | Marketplace / diretório | Não existe e é decisão de produto deliberada (ver `docs/identidade.md`, "Sem marketplace, sem diretório"). |
| 12 | Cota de agendamentos por plano | Existe no schema/código mas está desativada (`lib/plan-guard.ts:74-78`) — nunca usar como diferencial. |
| 13 | Trial em unidade adicional | O trial de 30 dias grátis vale só para o primeiro estabelecimento do dono; a 2ª unidade em diante começa sem trial, a preço cheio. |

---

## 6. Promessas proibidas → substitutas

> Consolidado de `docs/plano-home-massoterapia.md` (seção 5) + itens adicionais desta task. Ver também `docs/instagram/promessas-proibidas.json` para a versão estruturada.

| Promessa proibida | Por que é proibida | Substituta permitida |
|---|---|---|
| Lembrete automático 24h antes | Cron desligado em produção (`1ce95d4`) — feature existe no código mas não roda | "Confirmação instantânea na hora de marcar" / "sinal pago = compromisso real" |
| Pix como meio de pagamento do sinal | Não processa Pix real; é invite-only na Stripe BR | "Sinal por cartão" |
| "R$ X por mês perdidos" (qualquer número sem fonte) | Sem pesquisa/dado citável — exposição a CDC art. 37 | Perda qualitativa ("dinheiro que sai da agenda antes de entrar no caixa") |
| E-mail de confirmação como benefício geral | `canUseBookingConfirmationEmails` é exclusivo do Business pago, nem trial inclui | Se mencionar, deixar explícito "recurso do plano Business" — ou omitir em conteúdo genérico |
| Redução de faltas em % (ex.: "reduza faltas em 40%") | Nenhum dado interno mede isso | Mecânica sem número: "sinal pago reduz o incentivo a faltar sem avisar" |
| WhatsApp automático / notificação proativa | Não existe automação de WhatsApp | "Sem precisar responder WhatsApp o dia inteiro" (dor resolvida pelo link, não por automação) |
| "Agenda cheia" / qualquer resultado de negócio garantido | Produto entrega mecânica, não resultado garantido | Falar de dor + mecânica: "chega de parar o atendimento pra responder mensagem" |
| "Sem nenhuma taxa" | Taxa de processamento da Stripe existe e é do estabelecimento | "Sem taxa por agendamento" / "zero comissão do Agendaí" |
| Fidelidade gated por plano | Não há gate — disponível em todos os planos | "Disponível em todos os planos" |
| Cliente preenche a própria anamnese | Anamnese é preenchida pelo profissional, não existe no fluxo público do cliente | "Ficha sempre à mão antes do atendimento" (do ponto de vista do profissional) |
| "Cota/limite de agendamentos" como diferencial ou bloqueio | Cota está desativada no código (`lib/plan-guard.ts:74-78`) | Não mencionar limite de agendamentos em nenhum plano |
| "30 dias grátis" sem qualificar | Trial vale só para o primeiro estabelecimento do dono | Sempre que citar trial: "30 dias grátis, sem cartão (1º estabelecimento)" |

---

## 7. Tom de voz e identidade visual

- **Voz**: de empreendedor para empreendedor. Curto — se não cabe numa tela de celular sem rolar, está longo demais. No máximo 1 emoji, nunca forçado. Sem jargão de tecnologia ou marketing.
- **Estética visual**: wellness — sage green + off-white, luz natural, ambientes reais (não estoque genérico de tech).
- **CTA padrão**: "agendai.space — 30 dias grátis, sem cartão" (sempre entendido como 1º estabelecimento).
- **Screenshots reais disponíveis** em `Imagens/` — usar como referência de UI real, nunca mockup genérico:
  - `App Agendaí.png`
  - `Portal do gerente/`: agenda, clientes, Escala, funcionários, Menu, relatório, serviços (todos `.jpeg`)
  - `Portal do profissional/`: Agenda, Disponibilidade, Home, Menu, Relatório, Serviços do profissional (todos `.jpeg`)

---

## 8. Personagens recorrentes dos Reels IA

Usar estas descrições **verbatim** em prompts de geração de vídeo/imagem para manter consistência visual entre posts.

- **LARA** — massoterapeuta dona de estúdio, brasileira, 35 anos, cabelo cacheado escuro preso, polo verde sage.
- **CAMILA** — cliente fiel, brasileira, 40 anos, cabelo castanho liso, blusa de linho.
- **JÚLIA** — terapeuta da equipe da Lara, 27 anos, cabelo preto liso em rabo baixo, mesma polo verde sage, calma e focada.

### Formato de Reel que funcionou

- Prompt de geração em **inglês**; diálogo e textos de tela em **PT-BR**.
- 4 cenas com timestamps, duração total ~20-30s.
- Card final: `agendai.space` + "30 dias grátis".
- Se a ferramenta de geração limitar a duração, dividir em clipes de 8-10s.

---

## Fontes lidas nesta task

- `docs/identidade.md` (completo)
- `docs/outreach-whatsapp.md` (seções "Dores que a abordagem explora")
- `docs/plano-home-massoterapia.md` (seção 5 — Promessas proibidas)
- `lib/plan-guard.ts` (completo — gates confirmados por leitura direta)
- `prisma/schema.prisma` (trechos: `TenantSettings`, `Service`, `ScheduleException`/`RecurringScheduleException`/`AppointmentBlock`, `AppointmentExtra`, `LoyaltyPlan`/`LoyaltyProgress`/`LoyaltyRedemption`, `PushSubscription`, `ServicePackage`/`ClientPackage`/`PackageConsumption`)
- `prisma/seed.ts` (preços e limites de plano)
- `app/onboarding/actions.ts` (regra de trial só no 1º estabelecimento)
- `components/dashboard/AiChat.tsx` (gate do AgendaIA)
- `Imagens/` (listagem de screenshots reais disponíveis)
