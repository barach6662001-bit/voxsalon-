# VoxSalon — Project Context

## What this is

AI voice receptionist for Ukrainian cosmetology and med-spa clinics. Answers missed calls in Ukrainian, qualifies the caller (service, time, name, phone), sends a Telegram summary to the owner. No automatic booking yet — owner confirms manually.

## MVP scope (V0)

- Vapi handles inbound call (Ukrainian voice via ElevenLabs)
- AI greets caller, asks: service, preferred date/time, name, phone
- After call ends, Vapi sends webhook to our server
- Server parses webhook → formats Ukrainian summary → sends to owner's Telegram
- Log full call payload (transcript + audio URL) to JSONL file

## Explicitly out of scope for V0

- No web dashboard
- No Altegio / GBooking / YClients integration (manual confirmation by owner)
- No automatic booking
- No voice cloning of owner
- No multi-language (Ukrainian only)
- No payments / Stripe billing
- No multi-tenant (one client deployed per instance for now)
- No database (JSONL file is enough)
- No tests until product-market fit

If a feature is not listed in "MVP scope", do not add it. Ask first.

## Stack

- Node.js 20+ with TypeScript (strict mode)
- Fastify (lighter than Express, simpler than Hono)
- Vapi (voice AI middleware) — handles SIP/STT/LLM/TTS in one
- node-telegram-bot-api — owner notifications
- zod — validate Vapi webhook payloads, env vars
- pino — structured logs
- Vercel or fly.io for production hosting
- ngrok for local dev (tunneling Vapi webhooks to localhost)
- Biome instead of ESLint+Prettier (one tool, fast)

## Conventions

- TypeScript strict mode, no `any`
- All env vars validated via zod at startup; fail-fast if missing
- Single config file: `src/config.ts`
- No DI containers, no class hierarchies — plain functions
- One file per route, one file per external service
- No premature abstractions. Inline duplicates twice before extracting

## Common commands

- `pnpm dev` — Fastify with hot reload via tsx watch
- `pnpm start` — production
- `pnpm tunnel` — ngrok tunnel pointing at PORT
- `pnpm log:tail` — tail call_logs.jsonl with pretty formatting
- `pnpm typecheck` — tsc --noEmit
- `pnpm format` — biome format --write .

## File structure

```
src/
  server.ts          — Fastify entry, registers routes
  config.ts          — env vars (zod-validated)
  routes/
    vapi-webhook.ts  — POST /webhook/vapi
    health.ts        — GET /health
  services/
    telegram.ts      — sendCallSummary()
    parser.ts        — extractCallData(transcript) → structured object
    logger.ts        — pino instance
  types.ts           — zod schemas: VapiPayload, CallSummary
data/
  call_logs.jsonl    — append-only call log (gitignored)
.env.example
.env                 — gitignored
README.md
CLAUDE.md            — this file
```

## Webhook flow

```
Caller dials Vapi number
  ↓
Vapi answers, runs assistant in Ukrainian
  ↓
Call ends
  ↓
Vapi POST /webhook/vapi with type: "end-of-call-report"
  ↓
Server validates payload (zod)
  ↓
Parser extracts: service, desired_time, name, phone
  ↓
Telegram: send formatted message to owner's chat
  ↓
Append raw payload to data/call_logs.jsonl
  ↓
Return 200
```

## Telegram message format (Ukrainian)

```
📞 Новий пропущений дзвінок

⏰ {timestamp formatted as DD.MM.YYYY HH:mm}
👤 {caller name or "не назвався"}
📱 {caller phone}
💅 Послуга: {service or "не вказано"}
📅 Бажаний час: {desired time or "не вказано"}

📝 Запис: {recording_url}
📋 Початок розмови: {first 200 chars of transcript}...
```

## Vapi assistant prompt (Ukrainian)

When configuring the Vapi assistant, use this system prompt as a starting point:

```
Ти - адміністратор косметологічного кабінету. Відповідай українською мовою, дружньо і професійно. Твоє завдання - прийняти запит клієнта і зібрати інформацію для запису.

Зібери:
1. Яка послуга цікавить
2. Бажана дата і час
3. Ім'я клієнта
4. Номер телефону для зворотного зв'язку

Якщо клієнт ставить запитання про ціну чи процедуру - відповідай чесно: "Точну вартість і деталі підкаже наш фахівець, ми передзвонимо вам протягом години."

Розмова має бути короткою - 1-2 хвилини максимум. Не вигадуй послуги яких немає. Якщо щось незрозуміло - перепитуй.
```

## When in doubt

Optimize for: **speed to first paying customer**. Not architecture, not scalability, not code beauty.

If you're about to add abstraction, dependency, or pattern that doesn't directly help reach the next salon — stop and ask.
