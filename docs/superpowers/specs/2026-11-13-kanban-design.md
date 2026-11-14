# FlowBoard (Kanban em tempo real) — Design

Repositório: `lucasaccioly/kanban-realtime` (público, MIT, `© Lucas Accioly`). UI e README em pt-BR; código e commits em inglês.

## Por quê
Terceiro projeto de portfólio do Lucas para conseguir novas vagas. O FinTrack mostra full-stack CRUD com
dashboards e a API de Sorteios mostra backend Java com concorrência. Este projeto cobre o que faltava:
**tempo real** (várias pessoas no mesmo quadro vendo mudanças ao vivo) e **integração com IA**.
Sucesso = um recrutador abre o link, entende em segundos e vê algo se mexendo ao vivo sem precisar de outra pessoa.

## Objetivos
- Quadro Kanban colaborativo com atualização ao vivo entre abas/pessoas (WebSocket).
- Demo que funciona com **uma pessoa só**: modo visitante + "colega virtual" que mexe no quadro.
- Resumo do quadro por IA, gratuito (Groq), sem quebrar a demo quando a cota acabar.
- Código que aguente entrevista técnica: testes de integração do tempo real com Postgres real, CI.
- README que vende em 30 s (GIF de duas janelas sincronizando, link da demo, decisões técnicas).

## Não-objetivos
- Redis / várias instâncias do servidor (a demo roda em 1 instância; Redis adapter do Socket.io fica citado
  no README como próximo passo para escalar).
- App mobile, notificações por e-mail, anexos de arquivo, modo offline, permissões finas (só dono x membro).
- Edição colaborativa de texto caractere a caractere (CRDT) — campos usam "última escrita vence".

## Anti-objetivos (falha mesmo se funcionar)
- Recrutador abre o link e vê tela em branco ou quebrada.
- Um visitante ver ou alterar o quadro de outro visitante sem convite.
- Chave da IA exposta no front-end.
- Qualquer menção a sistemas da empresa onde o Lucas trabalha.

## Abordagens consideradas
| | Como | Trade-off |
|---|---|---|
| A | Tudo num serviço no Render (site + Socket.io) + Neon | 1 link, deploy simples; site inteiro espera ~1 min no primeiro acesso |
| **B (escolhida pelo Lucas)** | Site no **Vercel** + servidor Express/Socket.io no **Render** + **Neon** | Quadro abre na hora; enquanto o Render acorda mostra "conectando ao servidor…"; dois deploys e CORS |
| C | Realtime gerenciado (Supabase Realtime/Pusher) só no Vercel | Sem espera, mas não mostra o Lucas construindo o tempo real; descartada |

IA: Claude/OpenAI pagos foram descartados pelo Lucas ("use alguma outra de graça"). Gemini tem cota
gratuita reduzida e pode usar dados para treino → **Groq (plano gratuito, sem cartão, modelos Llama)**.

## Funcionalidades
1. **Conta:** cadastro/login (e-mail + senha) e **"Entrar como visitante"** (usuário temporário com um
   quadro de exemplo já preenchido). Visitantes com mais de 24 h são apagados por um job horário no servidor.
2. **Quadros:** criar, renomear, apagar (só o dono). Lista "Meus quadros" (dono ou membro).
3. **Convite:** o dono gera um **link de convite**; quem abre (logado ou visitante) vira membro. Pode revogar o link.
4. **Colunas:** criar, renomear, reordenar, apagar (com cartões dentro → pede confirmação).
5. **Cartões:** título, descrição, responsável (um membro), prazo, etiquetas coloridas fixas
   (ex.: bug, feature, urgente). Arrastar e soltar entre colunas e dentro da coluna.
6. **Tempo real:** toda mudança aparece para os outros membros do quadro sem recarregar.
   **Presença:** avatares de quem está online no quadro; indicador "Ana está editando este cartão".
7. **Histórico:** feed "Ana moveu 'Login' para Feito há 2 min" (últimas 50 ações, persistido).
8. **Colega virtual (só no quadro de exemplo do visitante):** enquanto há alguém com o quadro aberto, um membro
   fictício ("Bia (bot)") faz uma ação a cada ~20 s (move um cartão, cria um cartão, muda responsável),
   pelo mesmo caminho do servidor que um humano usa — assim o tempo real aparece mesmo sozinho.
   Para quando ninguém está online no quadro. Botão para pausar.
9. **Resumo por IA:** botão "Resumir quadro" → texto curto em pt-BR: progresso por coluna, cartões atrasados
   ou parados há muito tempo, sugestão de próximos passos. Gerado no servidor (chave nunca vai ao front).
   Limites: 5 resumos por usuário por dia e teto global diário configurável (padrão 200); acima disso,
   ou se o Groq falhar/estiver sem chave, mostra "Resumo indisponível agora (limite diário atingido), tente amanhã"
   e o resto do quadro segue normal.

## Stack (minha decisão, seguindo o FinTrack)
- Monorepo npm workspaces: `server` e `web`, TypeScript, Node ≥ 22.
- **server:** Express 5 + **Socket.io 4** + Prisma 7 (adapter pg) + zod + bcryptjs + jsonwebtoken. Groq via
  `fetch` na API compatível com OpenAI (sem SDK).
- **web:** React 19 + Vite + Tailwind 4 + TanStack Query + react-router 7 + **dnd-kit** + socket.io-client.
- **Testes:** Vitest + supertest + **socket.io-client** contra Postgres real (embedded-postgres, como no FinTrack).
- **Deploy:** web no Vercel (estático, `VITE_API_URL` aponta para o Render); server no Render (free, Virginia,
  `render.yaml`); banco Neon criado pelo Vercel (mesma região us-east). CI no GitHub Actions.

## Modelo de dados (minha decisão)
- `User` (id, name, email único, passwordHash nulo p/ bots, isGuest, isBot, createdAt)
- `Board` (id, name, ownerId, inviteToken único nulo, isGuestDemo, createdAt)
- `BoardMember` (boardId, userId, joinedAt) — PK composta; o dono também é membro.
- `Column` (id, boardId, name, position: string)
- `Card` (id, columnId, title, description, assigneeId nulo, dueDate nulo, labels: string[], position: string,
  version int, createdAt, updatedAt)
- `Activity` (id, boardId, actorId nulo, actorName, type, payload json, createdAt)
- `AiUsage` (day: date, userId nulo = global, count) — contadores diários.

**Ordenação:** `position` é uma chave de **índice fracionário** (string ordenável entre duas vizinhas), então
mover um cartão grava só aquele cartão. Concorrência: o servidor é a fonte da verdade; cada mutação é validada,
gravada numa transação e só então transmitida. Edição de campos = última escrita vence; mover usa `version`
(se o cliente mandou versão velha, o servidor aplica mesmo assim e devolve o estado atual para o cliente se corrigir).

## Protocolo em tempo real (minha decisão)
- Handshake do Socket.io com o JWT (`auth.token`); token inválido → conexão recusada.
- `board:join {boardId}` → só membros entram na sala `board:<id>`; resposta = estado completo do quadro.
- Mutações vão por **HTTP REST** (validadas com zod, testáveis com supertest); depois de gravar, o servidor emite
  para a sala: `card:created|updated|moved|deleted`, `column:*`, `member:joined`, `activity:new`.
- Presença: `presence:update {online: userId[], editing: {cardId: userId}}` em entrar/sair/focar cartão.
- Cliente aplica a mudança de forma otimista e reconcilia com o evento do servidor (identifica as próprias
  mutações por um `clientMutationId`).
- Reconexão: ao reconectar, o cliente faz `board:join` de novo e substitui o estado local pelo do servidor.

## Segurança
- JWT no header `Authorization` (site e API em domínios diferentes → cookie de terceiro seria bloqueado).
  Token guardado em `localStorage`. **Atalho documentado no README:** vulnerável se houver XSS; mitigado por
  React escapar conteúdo e CSP restritiva no Vercel. Alternativa citada: proxy no mesmo domínio + cookie httpOnly.
- CORS só para a origem do site. Toda rota e evento checa se o usuário é membro do quadro → senão 404.
- Senhas com bcrypt; rate limit simples em memória no login e na criação de visitante (o servidor é de
  processo único, então memória basta).
- Chave do Groq e `JWT_SECRET` só no Render (`generateValue: true` para o JWT).

## Decisões minhas (para o Lucas conferir)
- Nome do produto **FlowBoard**; repositório `kanban-realtime`.
- Sem Redis (1 instância); citado como próximo passo.
- Colega virtual só em quadros de visitante, para a demo funcionar com uma pessoa.
- Mutações por REST + eventos por WebSocket (mais fácil de testar e validar do que mutações pelo socket).
- Limites de IA: 5/usuário/dia, 200/dia no total.
- Visitante expira em 24 h; limpeza ao iniciar o servidor e de hora em hora enquanto acordado.

## Decisões tomadas após a revisão do builder (minhas)
1. **Servidor dormindo (Render free dorme após ~15 min).** Sem "keep-alive": as 750 h grátis do Render são por
   conta e já são divididas com a API de Sorteios. Em vez disso, o site (Vercel) abre na hora com um
   **quadro de exemplo estático, só leitura**, e a faixa "Acordando o servidor (até ~1 min)… você já pode
   olhar o quadro". O site faz `GET /health` ao carregar; quando responde, troca para o modo ao vivo
   (botões de login/visitante habilitados). Assim nunca há tela em branco.
   A limpeza de visitantes roda **ao iniciar o servidor e de hora em hora** enquanto ele estiver acordado.
2. **Comentários não existem.** O colega virtual só faz o que humanos fazem: criar cartão, mover cartão,
   editar título/responsável. Nada de "comentar".
3. **Visitante expirado:** apaga o usuário; quadros **dos quais ele é dono** são apagados em cascata
   (colunas, cartões, membros, histórico), mesmo que tenham membros cadastrados; cartões de outros quadros
   atribuídos a ele ficam sem responsável (`SET NULL`); no histórico, `actorId` é anulável e cada entrada
   guarda `actorName` (cópia do nome), então o feed continua legível. Suas participações (`BoardMember`)
   em quadros de outros somem em cascata.
4. **Colega virtual:** um único usuário bot global "Bia (bot)" (`isBot`), membro **apenas do quadro de
   exemplo criado para cada visitante** (`isGuestDemo = true`). Roda quando há **pelo menos um humano
   online** naquele quadro (visitante ou convidado) e para quando a sala esvazia. Botão de pausar por quadro.
5. **Permissões:** só o **dono** renomeia/apaga o quadro, gera/revoga o link de convite e remove membros.
   **Membros** fazem todo o resto (colunas e cartões: criar, editar, mover, apagar) e podem **sair** do quadro.
   Não-membro recebe 404 em rotas e é recusado ao entrar na sala.

Pequenos ajustes de quem constrói (decididos agora): "dia" da cota de IA em UTC; JWT expira em 7 dias;
"cartão parado" = sem mudança há 3+ dias; rate limit de 10 logins/min e 5 visitantes/hora por IP.

## O que depende do Lucas
- Criar a conta no Groq e colar a chave no Render (ninguém digita credenciais por ele).
- Criar o banco Neon pelo Vercel e colar a senha no Render, como na API de Sorteios.

## Fica a critério de quem constrói
- Layout visual exato (seguir o estilo limpo do FinTrack), paleta das etiquetas, textos de UI.
- Modelo Llama exato no Groq (o menor/rápido disponível no plano gratuito na data do build).
- Biblioteca de índice fracionário (ex.: `fractional-indexing`) ou implementação própria pequena.
- Roteiro exato das ações do colega virtual.
