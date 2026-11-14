# FlowBoard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time collaborative Kanban (FlowBoard) with guest mode, a virtual teammate, and a free Groq board summary, deployed as Vercel (web) + Render (Express/Socket.io) + Neon.

**Architecture:** npm-workspaces monorepo (`server`, `web`) copying FinTrack's conventions. Mutations go over REST through service functions (also used by the bot), which write in a transaction and then publish a board event; a Socket.io layer relays events to the room `board:<id>`. The web app applies optimistic changes and reconciles through a pure reducer.

**Tech Stack:** Node ≥22, TypeScript ~5.9, Express 5, Socket.io 4, Prisma 7 (+ `@prisma/adapter-pg`), zod 4, bcryptjs, jsonwebtoken, `fractional-indexing`; React 19, Vite, Tailwind 4, TanStack Query 5, react-router 7, dnd-kit, socket.io-client; Vitest, supertest, embedded-postgres.

**Spec:** `docs/superpowers/specs/2026-11-13-kanban-design.md`

**Reference repo:** `../fintrack` — copy its patterns where a task says "as FinTrack" (`server/src/errors.ts`, `server/src/db.ts`, `server/prisma.config.ts`, `server/test/global-setup.ts`, `server/test/setup.ts`, `server/scripts/dev-db.ts`, `.github/workflows/ci.yml`, `web/src/components/ui.tsx` styling).

## Global Constraints

- UI copy and README in pt-BR; code, identifiers and commit messages in English. Repo `lucasaccioly/kanban-realtime`, MIT, `© Lucas Accioly`.
- No mention anywhere of the company where Lucas works (its name never appears in committed files or paths).
- Error JSON shape `{ error: string, details?: unknown }` (FinTrack `HttpError`). Zod errors → 400 "Dados inválidos".
- Anything on a board the caller is not a member of → **404 "Não encontrado"** (routes) / join refused (socket). Never 403 for membership.
- Auth: JWT HS256 `{ sub: userId }`, expires **7d**, sent as `Authorization: Bearer <token>`; socket handshake `auth.token`. Web stores it in `localStorage["fb_token"]`.
- `GROQ_API_KEY` and `JWT_SECRET` exist only on the server. The web bundle never contains them.
- Local ports (avoid FinTrack's): embedded Postgres **54330**, server **3002**, web **5174**.
- Fixed labels: `bug`, `feature`, `urgente`, `melhoria`.
- New boards get columns "A fazer", "Fazendo", "Feito".
- Limits: AI 5/user/day and `AI_GLOBAL_DAILY` (default 200)/day, day in UTC; login 10/min/IP; guest creation 5/hour/IP; guest TTL 24 h; cleanup at startup + hourly; bot tick ~20 s (`BOT_INTERVAL_MS`, default 20000); "parado" = no change for 3+ days; activity feed = last 50.
- AI unavailable copy (exact): `Resumo indisponível agora (limite diário atingido), tente amanhã`.

## Review Focus

1. A member removed from a board (or a board deleted) while their socket is in the room must stop receiving that board's events. (Task 5 test)
2. Moving a card into a column of **another** board, or with an `afterCardId` from another column/board → 404, nothing changes. (Task 4 test)
3. Two users moving the same card at nearly the same time → both clients end on the same state, equal to the database. (Task 5 test)
4. Deleting a column that has cards removes its cards and emits `column:deleted`; reloading the board shows neither. (Task 4 test)
5. Guest expiry when the guest owns a board with a registered member, and acted on another user's board → their board disappears for the member, the other board's activity keeps `actorName`, cards they were assigned become unassigned. (Task 6 test)

---

### Task 1: Monorepo scaffold, schema, test base, CI

**Files:**
- Create: `package.json`, `.gitignore`, `.gitattributes`, `LICENSE`, `.github/workflows/ci.yml`
- Create: `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `server/prisma.config.ts`, `server/prisma/schema.prisma`, `server/prisma/migrations/*` (generated), `server/scripts/dev-db.ts`
- Create: `server/src/app.ts`, `server/src/db.ts`, `server/src/errors.ts`, `server/src/index.ts`
- Create: `server/vitest.config.ts`, `server/test/global-setup.ts`, `server/test/setup.ts`, `server/test/health.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Express` (mounts `/api`, `GET /api/health → {ok:true}`, 404 JSON, `errorHandler`); `prisma`, `Tx` from `src/db.ts`; `HttpError`, `notFound()` from `src/errors.ts`; `resetDb()` in test setup truncating every table.
- Schema (exact models, spec "Modelo de dados" + builder rulings): `User{id uuid, name, email? unique, passwordHash?, isGuest bool, isBot bool, createdAt}`, `Board{id, name, ownerId → User onDelete Cascade, inviteToken? unique, isGuestDemo bool, botPaused bool default false, createdAt}`, `BoardMember{boardId → Board Cascade, userId → User Cascade, joinedAt, @@id([boardId,userId])}`, `Column{id, boardId → Board Cascade, name, position string, @@index([boardId])}`, `Card{id, columnId → Column Cascade, title, description default "", assigneeId? → User SetNull, dueDate? date, labels String[], position string, version int default 0, createdAt, updatedAt @updatedAt, @@index([columnId])}`, `Activity{id, boardId → Board Cascade, actorId? → User SetNull, actorName, type, payload Json, createdAt, @@index([boardId, createdAt])}`, `AiUsage{day date, scope string ("global" | userId), count int, @@id([day, scope])}`.

- [ ] **Step 1:** Root `package.json` as FinTrack (workspaces `server`,`web`; scripts `dev`, `test`, `typecheck`, `build`); `server/package.json` with scripts `db`, `dev` (`tsx watch src/index.ts`), `build` (`prisma generate && tsc -p tsconfig.build.json`), `start` (`prisma migrate deploy && node dist/index.js`), `typecheck`, `test`, `migrate`, `postinstall: prisma generate`. Install the server deps listed in Tech Stack. `dev-db.ts` as FinTrack with port 54330 and databases `flowboard`, `flowboard_test`.
- [ ] **Step 2:** Write `server/test/health.test.ts`: `GET /api/health` → 200 `{ok:true}`; `GET /api/nope` → 404 `{error:"Rota não encontrada"}`. Run `npm test -w server`. Expected: FAIL (no app).
- [ ] **Step 3:** Implement `app.ts` (express.json 1mb, `cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5174" })`, `x-powered-by` off), `db.ts`, `errors.ts` as FinTrack; schema + `npx prisma migrate dev --name init`; `index.ts` creates `http.createServer(createApp())` and listens on `PORT ?? 3002`.
- [ ] **Step 4:** Run `npm test -w server` and `npm run typecheck -w server`. Expected: PASS.
- [ ] **Step 5:** CI as FinTrack (postgres:17 service, db `flowboard_test`, env `JWT_SECRET`, steps `npm ci`, `typecheck`, `test`, `build`). Commit `chore: scaffold monorepo with Prisma schema, test base and CI`.

### Task 2: Auth (register, login, guest) and guest demo seed

**Files:**
- Create: `server/src/auth/token.ts`, `server/src/auth/routes.ts`, `server/src/auth/middleware.ts`, `server/src/lib/rateLimit.ts`, `server/src/seed/guestBoard.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/auth.test.ts`, `server/test/helpers.ts`

**Interfaces:**
- Produces: `signToken(userId: string): string`; `verifyToken(token: string): string` (userId, throws `HttpError(401)`); `requireAuth` (reads Bearer, sets `req.userId`); `rateLimit({ windowMs, max }): RequestHandler` keyed by `req.ip`, 429 `{error:"Muitas tentativas, tente mais tarde"}`, with `resetRateLimits()` for tests; `BOT_EMAIL = "bia.bot@flowboard.dev"`, `ensureBot(tx?): Promise<User>`; `createGuestDemoBoard(tx, guestId): Promise<string>` (board `isGuestDemo`, members guest + bot, 3 default columns, ~8 sample cards with labels/assignees/one overdue due date, 3 activity entries).
- Routes: `POST /api/auth/register {name 1..60, email, password 8..72}` → 201 `{token, user:{id,name,email,isGuest}}`, 409 "E-mail já cadastrado"; `POST /api/auth/login` → 200 same shape, 401 "E-mail ou senha inválidos" (10/min/IP); `POST /api/auth/guest` → 201 `{token, user, boardId}` (name "Visitante", 5/hour/IP); `GET /api/auth/me` → `{user}`.
- Test helpers: `app`, `registerUser(name?) → {token, user}`, `guestUser() → {token, user, boardId}`, `auth(token) → {Authorization}`.

- [ ] **Step 1:** Write tests: register returns token and lowercased email; duplicate email (other case) → 409; login wrong password → 401; `me` with no/invalid/expired token → 401; guest → 201 with `boardId`, board has 3 columns, ≥8 cards, members include the bot; 6th guest from same IP in an hour → 429; 11th login in a minute → 429.
- [ ] **Step 2:** Run `npm test -w server -- auth`. Expected: FAIL.
- [ ] **Step 3:** Implement the files above (bcrypt cost 10; email trimmed + lowercased; guest + board in one transaction).
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add JWT auth, guest mode and demo board seed`.

### Task 3: Boards, membership and invites

**Files:**
- Create: `server/src/boards/access.ts`, `server/src/boards/service.ts`, `server/src/boards/routes.ts`, `server/src/realtime/bus.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/boards.test.ts`

**Interfaces:**
- Produces `realtime/bus.ts`: `type BoardEvent = { type: "card:created"|"card:updated"|"card:moved"|"card:deleted"|"column:created"|"column:updated"|"column:deleted"|"board:updated"|"board:deleted"|"member:joined"|"member:left"|"activity:new"; payload: unknown; clientMutationId?: string }`; `publish(boardId: string, event: BoardEvent): void`; `setPublisher(fn)`; `onMembershipRevoked(fn: (boardId, userId) => void)` + `revokeMembership(boardId, userId)` (Task 5 wires both); `recordedEvents()`/`clearRecorded()` test helpers (default publisher records).
- Produces `access.ts`: `requireMember(boardId, userId): Promise<Board>` (404 otherwise); `requireOwner(boardId, userId)` — non-member → 404; member who is not the owner → **403 "Apenas o dono pode fazer isso"** (they already know the board exists, so 403 leaks nothing).
- Produces `service.ts`: `getBoardState(boardId): Promise<BoardState>` where `BoardState = { board:{id,name,ownerId,inviteToken:string|null,isGuestDemo,botPaused}, members:{id,name,isBot}[], columns:{id,name,position,cards:CardDto[]}[] (sorted by position), activity: ActivityDto[] (newest first, 50) }`, `CardDto = {id,columnId,title,description,assigneeId,dueDate,labels,position,version,updatedAt}`, `ActivityDto = {id, actorName, type, payload, createdAt}`; `logActivity(tx, boardId, actor:{id,name}, type, payload): Promise<ActivityDto>` (publishes `activity:new` after commit by caller).
- Routes (all `requireAuth`): `GET /api/boards` → `{boards:{id,name,isOwner,memberCount}[]}`; `POST /api/boards {name 1..80}` → 201 `BoardState`; `GET /api/boards/:id` → `BoardState`; `PATCH /api/boards/:id {name}` owner; `DELETE /api/boards/:id` owner → 204 + `board:deleted` + revoke all members; `POST /api/boards/:id/invite` owner → `{inviteToken}` (random 24-byte base64url); `DELETE /api/boards/:id/invite` owner → 204; `POST /api/invites/:token/join` → `{boardId}` (idempotent, emits `member:joined` once, 404 bad token); `POST /api/boards/:id/leave` → 204 (owner → 409 "O dono não pode sair do quadro"); `DELETE /api/boards/:id/members/:userId` owner → 204 + `member:left` + revoke.

- [ ] **Step 1:** Write tests: create board → 3 columns in order; non-member GET/PATCH/DELETE → 404; member PATCH → 403; invite → join by other user → appears in their list, `member:joined` recorded; revoked token → 404; join twice → one membership; leave works for member, 409 for owner; owner removes member → member gets 404 afterwards.
- [ ] **Step 2:** Run `npm test -w server -- boards`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add boards, membership and invite links`.

### Task 4: Columns and cards (services, fractional ordering, activity)

**Files:**
- Create: `server/src/lib/position.ts`, `server/src/columns/service.ts`, `server/src/columns/routes.ts`, `server/src/cards/service.ts`, `server/src/cards/routes.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/position.test.ts`, `server/test/cards.test.ts`

**Interfaces:**
- Produces `position.ts`: `between(before: string|null, after: string|null): string` (wraps `generateKeyBetween` from `fractional-indexing`).
- Produces services, each `(actor: {id,name}, ..., clientMutationId?: string)`, validating membership via the entity's board, writing in one transaction, then publishing the event + `activity:new`:
  - `createColumn(actor, boardId, name)`, `updateColumn(actor, columnId, {name?, afterColumnId?: string|null})`, `deleteColumn(actor, columnId)`
  - `createCard(actor, columnId, {title 1..120, description ≤2000, assigneeId?, dueDate?, labels?})` (appends at bottom), `updateCard(actor, cardId, patch)` (version++), `moveCard(actor, cardId, {columnId, afterCardId: string|null, version: number})` → `CardDto` (version++; stale `version` still applies — last write wins), `deleteCard(actor, cardId)`.
  - Validation: `assigneeId` must be a board member (400 "Responsável não é membro do quadro"); labels ⊂ fixed set; target column and `afterCardId` must belong to the same board (and `afterCardId` to the target column) else 404.
- Routes: `POST /api/boards/:id/columns`, `PATCH|DELETE /api/columns/:id`, `POST /api/columns/:id/cards`, `PATCH|DELETE /api/cards/:id`, `POST /api/cards/:id/move`. Header `X-Client-Mutation-Id` → `clientMutationId`. Activity types: `card.created|card.moved|card.updated|card.deleted|column.created|column.deleted|column.renamed`; `card.moved` payload `{cardId,title,fromColumn,toColumn}` (names).

- [ ] **Step 1:** `position.test.ts`: `between(null,null)` < `between(x,null)`; 50 inserts at the top stay sorted; `between(a,b)` strictly between.
- [ ] **Step 2:** `cards.test.ts`: create card → event `card:created` with the request's clientMutationId; move to top of another column → order in `getBoardState` matches; move with stale version → 200 and version increments; move into another board's column → 404 and DB unchanged (Review Focus 2); `afterCardId` from other column → 404; assignee not member → 400; invalid label → 400; delete column with 2 cards → cards gone, `column:deleted` emitted (Review Focus 4); activity feed shows "card.moved" with column names; non-member mutation → 404.
- [ ] **Step 3:** Run `npm test -w server -- cards position`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test -w server`. Expected: PASS. Commit `feat: add columns and cards with fractional ordering and activity log`.

### Task 5: Socket.io realtime layer and presence

**Files:**
- Create: `server/src/realtime/socket.ts`, `server/src/realtime/presence.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/realtime.test.ts`, `server/test/socketHelpers.ts`

**Interfaces:**
- Consumes: `bus.setPublisher`, `onMembershipRevoked`, `verifyToken`, `requireMember`, `getBoardState`.
- Produces `attachRealtime(httpServer: http.Server): Server` — handshake verifies `auth.token` (bad → `connect_error` "Não autenticado"); `board:join {boardId}` ack `{ok:true, state: BoardState} | {ok:false, error:"Não encontrado"}`; `board:leave {boardId}`; `card:focus {boardId, cardId|null}`; emits `presence:update {boardId, online: string[] (userIds, humans + bot when acting), editing: Record<cardId,userId>}` on join/leave/disconnect/focus. Publisher → `io.to("board:"+id).emit(event.type, {...payload, clientMutationId})`. Revocation → all sockets of that user leave the room and get `board:removed {boardId}`.
- Produces `presence.ts`: `onlineHumans(boardId): string[]`, `boardsWithHumansOnline(): string[]` (used by the bot), `resetPresence()`.
- `socketHelpers.ts`: `startTestServer() → {url, close}` on an ephemeral port; `connect(url, token) → Socket`; `joinBoard(socket, boardId) → ack`; `nextEvent(socket, name, timeoutMs=2000)`.

- [ ] **Step 1:** Tests: bad token rejected; non-member join → `{ok:false}`; two members joined → A moves card via REST → B receives `card:moved` with the card and A's clientMutationId; presence lists both, then one after disconnect; `card:focus` shows in `editing`; removed member's socket gets `board:removed` and **no** later `card:created` (Review Focus 1); two near-simultaneous moves of one card (Promise.all) → both clients' last `card:moved` payload equals `getBoardState` (Review Focus 3); rejoin after reconnect returns fresh state.
- [ ] **Step 2:** Run `npm test -w server -- realtime`. Expected: FAIL.
- [ ] **Step 3:** Implement; `index.ts` calls `attachRealtime(server)` (CORS origin `WEB_ORIGIN`).
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add Socket.io realtime sync and presence`.

### Task 6: Guest cleanup and virtual teammate

**Files:**
- Create: `server/src/jobs/cleanupGuests.ts`, `server/src/bot/teammate.ts`
- Modify: `server/src/index.ts`, `server/src/boards/routes.ts` (bot pause)
- Test: `server/test/cleanup.test.ts`, `server/test/bot.test.ts`

**Interfaces:**
- Produces `cleanupGuests(now: Date): Promise<number>` — deletes `isGuest` users with `createdAt < now − 24h` (schema cascades/SetNull do the rest). `index.ts`: run once on start, then `setInterval` hourly (unref).
- Produces `botTick(now: Date): Promise<number>` — for each board in `boardsWithHumansOnline()` that `isGuestDemo && !botPaused`, performs **one** action as the bot through the Task 4 services: move a random card to the next column (wraps to first), or create a card from a fixed pt-BR list, or set an assignee; returns actions done. `startBot(intervalMs = Number(process.env.BOT_INTERVAL_MS ?? 20000))`. Bot shows in `presence.online` only while acting (not required to test).
- Route: `PATCH /api/boards/:id/bot {paused: boolean}` (any member of an `isGuestDemo` board; others 404) → `board:updated`.

- [ ] **Step 1:** `cleanup.test.ts` (Review Focus 5): registered R and guest G (created 25 h ago); G owns a board where R is member; R owns a board where G is member, G moved a card there and is assignee of a card → after `cleanupGuests` → G's board gone (R's list lacks it), R's board activity still shows `actorName:"Visitante"`, card assignee null; a guest created 23 h ago survives; returns count 1.
- [ ] **Step 2:** `bot.test.ts`: with a guest socket joined to its demo board, `botTick` returns 1 and the socket receives a card event whose activity actor is "Bia (bot)"; with nobody online → 0; with `botPaused` → 0; on a non-demo board with members online → 0.
- [ ] **Step 3:** Run `npm test -w server -- cleanup bot`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test -w server`. Expected: PASS. Commit `feat: add guest cleanup job and virtual teammate`.

### Task 7: AI board summary via Groq with quotas

**Files:**
- Create: `server/src/ai/groq.ts`, `server/src/ai/quota.ts`, `server/src/ai/summary.ts`
- Modify: `server/src/boards/routes.ts`
- Test: `server/test/summary.test.ts`

**Interfaces:**
- Produces `groqChat(messages: {role:"system"|"user", content:string}[]): Promise<string>` — `fetch("https://api.groq.com/openai/v1/chat/completions")`, model `process.env.GROQ_MODEL` (builder picks the current small Llama on Groq's free tier as default), `max_tokens` 400, timeout 15 s; throws if no `GROQ_API_KEY` or non-2xx.
- Produces `tryConsume(userId: string, day: string): Promise<boolean>` / `refund(userId, day)` — atomic upserts on `AiUsage` for scope `userId` (limit 5) and `"global"` (limit `AI_GLOBAL_DAILY ?? 200`).
- Produces `buildSummaryPrompt(state: BoardState, now: Date): string` (pt-BR; counts per column, overdue cards, cards unchanged ≥3 days, asks for ≤120 words: progresso, riscos, próximos passos).
- Route: `POST /api/boards/:id/summary` (member) → 200 `{summary}`; quota exceeded → 429; missing key / Groq failure → 503 (quota refunded); both with the exact copy from Global Constraints.

- [ ] **Step 1:** Tests with `vi.stubGlobal("fetch", ...)`: success returns text and sends `Authorization: Bearer <key>` (key never in response); 6th call same user/day → 429 exact copy; global limit (set `AI_GLOBAL_DAILY=2`) → 3rd call from another user 429; Groq 500 → 503 and quota unchanged; no key → 503; non-member → 404; prompt includes an overdue card title and "parado".
- [ ] **Step 2:** Run `npm test -w server -- summary`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add AI board summary via Groq with daily quotas`.

### Task 8: Web foundation (client, auth, boards list, wake-up preview)

**Files:**
- Create: `web/` (Vite React TS: `package.json`, `vite.config.ts` port 5174, `index.html`, `tsconfig.json`, `src/main.tsx`, `src/index.css`), `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/auth/AuthContext.tsx`, `web/src/components/ui.tsx`, `web/src/components/ServerStatus.tsx`, `web/src/demo/previewBoard.ts`, `web/src/pages/Landing.tsx`, `web/src/pages/Auth.tsx`, `web/src/pages/Boards.tsx`, `web/src/pages/JoinInvite.tsx`, `vercel.json`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Produces `apiFetch<T>(path: string, init?: RequestInit & { mutationId?: string }): Promise<T>` — base `import.meta.env.VITE_API_URL ?? "http://localhost:3002"`, adds Bearer from `localStorage.fb_token`, sends `X-Client-Mutation-Id`, throws `ApiError{status, message}` using server `error`; on 401 clears the token.
- Produces `useServerAwake(): "waking" | "up"` — polls `GET /api/health` every 3 s until 200.
- Produces `types.ts` mirroring server DTOs (`BoardState`, `CardDto`, `ActivityDto`, `BoardEvent` names).
- Routes: `/` Landing (logged out: renders `previewBoard` read-only through the Task 9 `BoardView` with `readOnly` — until Task 9 lands, a minimal read-only column/card render is acceptable — plus banner "Acordando o servidor (até ~1 min)… você já pode olhar o quadro" while `waking`; buttons "Entrar como visitante", "Entrar", "Criar conta" disabled while waking); `/entrar`, `/cadastro`; `/quadros` (list + create); `/convite/:token` (requires login, then joins and redirects to `/quadros/:id`). Logged-in `/` → `/quadros`; guest login → straight to its demo board.
- `vercel.json`: SPA rewrite to `/index.html`; header `Content-Security-Policy` allowing `connect-src 'self' <API origin> wss://<API host>` (builder parametrizes via the deployed URL in Task 10).

- [ ] **Step 1:** `client.test.ts`: adds Bearer header when token set; sends `X-Client-Mutation-Id`; maps `{error}` to `ApiError.message`; 401 clears `fb_token`.
- [ ] **Step 2:** Run `npm test -w web`. Expected: FAIL.
- [ ] **Step 3:** Implement the files (Tailwind styling consistent with FinTrack's `ui.tsx`).
- [ ] **Step 4:** Run `npm test -w web` and `npm run build -w web`. Expected: PASS. Manual: `npm run dev`, stop the server → landing shows the preview + banner; start it → buttons enable; guest login lands on the board route.
- [ ] **Step 5:** Commit `feat: add web shell, auth flows and wake-up preview`.

### Task 9: Board UI (drag and drop, realtime, presence, activity, AI, invite)

**Files:**
- Create: `web/src/board/reducer.ts`, `web/src/board/useBoardSocket.ts`, `web/src/board/BoardView.tsx`, `web/src/board/CardModal.tsx`, `web/src/board/PresenceBar.tsx`, `web/src/board/ActivityFeed.tsx`, `web/src/board/SummaryPanel.tsx`, `web/src/board/ShareDialog.tsx`, `web/src/pages/BoardPage.tsx`
- Test: `web/src/board/reducer.test.ts`

**Interfaces:**
- Consumes: server events/acks from Task 5, REST from Tasks 3/4/6/7, `apiFetch`.
- Produces `boardReducer(state: ClientBoardState, action: ServerEvent | {type:"optimistic:move", cardId, columnId, afterCardId, mutationId} | {type:"reset", state: BoardState}): ClientBoardState` — `ClientBoardState = BoardState & { pending: Record<mutationId, true> }`; server event with a pending `clientMutationId` clears it and applies the server version (server wins); optimistic move computes a temporary position between neighbours so order is right immediately.
- Produces `useBoardSocket(boardId)` → `{state, dispatch, connection: "connecting"|"live"|"reconnecting", presence}` — joins on connect and on every reconnect (`reset` with fresh state); on `board:removed` navigates to `/quadros` with toast "Você não tem mais acesso a este quadro".
- UI: columns horizontal, dnd-kit sortable cards across columns (calls `POST /api/cards/:id/move` with `afterCardId` = card above in target column); add/rename/delete column (confirm if it has cards); card modal edits title, description, assignee (members), due date, labels and emits `card:focus`; presence avatars + "Ana está editando" on the card; activity feed (relative time pt-BR); "Resumir quadro" button showing summary or the unavailable copy; share dialog (owner: create/revoke invite link with copy button; members list; remove member); bot pause toggle on demo boards; connection pill.

- [ ] **Step 1:** `reducer.test.ts`: `card:moved` from another user reorders; optimistic move then own echo → single card, server position, pending cleared; echo arrives with different position (server won) → server position kept; `card:deleted` of a card being moved optimistically → card removed, pending cleared; `column:deleted` removes its cards; `reset` replaces everything.
- [ ] **Step 2:** Run `npm test -w web`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web`, `npm run typecheck`, `npm run build`. Expected: PASS. Manual check with the in-app browser: two tabs (guest A; register B and join via A's invite) → dragging in A appears in B within ~1 s; presence shows both; Bia moves cards on the demo board; summary shows the unavailable copy when `GROQ_API_KEY` is unset.
- [ ] **Step 5:** Commit `feat: add realtime board UI with drag and drop, presence and AI summary`.

### Task 10: Deploy config, README, publish

**Files:**
- Create: `render.yaml`, `README.md`, `docs/screenshot.png` (or GIF if recordable)
- Modify: `vercel.json` (final CSP), root `package.json` (`vercel-build`: `npm run build -w web`)

**Interfaces:**
- `render.yaml`: web service `flowboard-api`, `runtime: node`, `plan: free`, `region: virginia`, `buildCommand: npm ci && npm run build -w server`, `startCommand: npm run start -w server`, `healthCheckPath: /api/health`, env `NODE_VERSION=22`, `DATABASE_URL` (sync false; **postgres:// URL**, unpooled host), `JWT_SECRET` (`generateValue: true`), `GROQ_API_KEY` (sync false), `WEB_ORIGIN` (sync false).
- README (pt-BR): pitch, badges, demo link + "abra em duas janelas" tip + cold-start note, GIF/screenshot, how realtime works (diagram: REST → transaction → bus → Socket.io room → reducer), decisions (REST+events, fractional indexing, last-write-wins, server-authoritative reconciliation, 404 vs 403, token in localStorage trade-off + CSP, no Redis and the Redis adapter as next step, Groq quotas), endpoints + events table, run locally, tests, license.

- [ ] **Step 1:** Write the files; `npm run typecheck && npm test && npm run build` at root. Expected: PASS.
- [ ] **Step 2:** Scan committed files for the employer's name → expected: no matches.
- [ ] **Step 3:** Commit `docs: add README and deploy config`; create public repo `lucasaccioly/kanban-realtime` (description pt-BR, topics `react typescript socket-io websocket nodejs postgresql kanban`), push `main`, confirm CI green.

### Task 11: Deploy with Lucas (human-in-the-loop)

- [ ] Create Neon DB `flowboard-db` via Vercel Storage (us-east, Auth off), read only host/user/db (never the password).
- [ ] Render: install already done for `lucasaccioly`; New Blueprint → `kanban-realtime`; Lucas pastes the DB password into `DATABASE_URL` and the Groq key (he creates the Groq account/key).
- [ ] Vercel: import `kanban-realtime` as a new project (root = repo, build `npm run vercel-build`, output `web/dist`, env `VITE_API_URL=<render url>`); then set Render `WEB_ORIGIN=<vercel url>`.
- [ ] Verify live: landing preview while waking, guest board, Bia acting, two-window sync, summary; update README demo links, repo homepage, profile README row "Kanban em tempo real" and bio.
