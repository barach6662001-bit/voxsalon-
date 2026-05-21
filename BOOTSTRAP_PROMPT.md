# Bootstrap Prompt for Claude Code

Paste this into Claude Code (`claude` in terminal) on first run inside the empty repo.

---

I'm building VoxSalon — an AI voice receptionist for Ukrainian cosmetology clinics. Read CLAUDE.md fully before doing anything.

In this session, do exactly this and nothing more:

1. **Initialize the project:**
   - `pnpm init`
   - Install runtime deps: `fastify @fastify/sensible zod node-telegram-bot-api pino pino-pretty dotenv`
   - Install dev deps: `typescript tsx @types/node @biomejs/biome vitest`
   - Create `tsconfig.json` with strict mode, target ES2022, moduleResolution bundler, outDir dist
   - Create `biome.json` with default formatter + linter config
   - Add scripts to `package.json`:
     - `dev`: `tsx watch src/server.ts`
     - `start`: `node dist/server.js`
     - `build`: `tsc`
     - `tunnel`: `ngrok http 3000`
     - `log:tail`: `tail -f data/call_logs.jsonl | pino-pretty`
     - `typecheck`: `tsc --noEmit`
     - `format`: `biome format --write .`

2. **Create `src/config.ts`:**
   - Use `dotenv/config`
   - Define a zod schema for env vars (all required ones from `.env.example` except optional sections)
   - Parse `process.env` through the schema
   - Export validated `config` object
   - On parse failure, log error and `process.exit(1)`

3. **Create `src/services/logger.ts`:**
   - Initialize and export a pino instance
   - In dev mode, use pino-pretty transport

4. **Create `src/types.ts`:**
   - Define zod schemas for Vapi `end-of-call-report` webhook payload
   - Schema fields (guess reasonable structure, we'll adjust after first real call):
     - `type: "end-of-call-report"`
     - `call.id, call.startedAt, call.endedAt`
     - `call.customer.number` (caller phone)
     - `call.transcript` (full string)
     - `call.recordingUrl`
     - `call.summary` (Vapi's auto-summary)
   - Export inferred TS type
   - Also define `CallSummary` interface for the parsed/extracted data

5. **Create `src/services/parser.ts`:**
   - Function `extractCallData(transcript: string): CallSummary`
   - For now, just return a stub that extracts via simple regex/heuristics (Ukrainian text)
   - Look for service words, names after "мене звати" / "я", date/time patterns
   - It's okay to return mostly empty fields — we'll improve with Claude as LLM later

6. **Create `src/services/telegram.ts`:**
   - Initialize `TelegramBot` (polling false, just sender)
   - Export `sendCallSummary(payload: VapiPayload, parsed: CallSummary)`
   - Format message in Ukrainian exactly as specified in CLAUDE.md
   - Send to `config.TELEGRAM_OWNER_CHAT_ID`

7. **Create `src/routes/health.ts`:**
   - GET `/health` returns `{ status: "ok", timestamp }`

8. **Create `src/routes/vapi-webhook.ts`:**
   - POST `/webhook/vapi`
   - Validate body with zod (use `safeParse`, return 400 on failure)
   - If `type === "end-of-call-report"`:
     - Call parser to extract structured data
     - Call telegram service to send summary
     - Append raw payload to `data/call_logs.jsonl` (one JSON per line)
   - Always return `{ ok: true }` with 200

9. **Create `src/server.ts`:**
   - Create Fastify instance with logger from `services/logger.ts`
   - Register `@fastify/sensible`
   - Register routes
   - Listen on `config.PORT`
   - Log startup info

10. **Create `data/.gitkeep`** so the directory exists

11. **Run `pnpm typecheck`** to verify everything compiles

12. **Print final summary:**
    - Files created
    - Next manual steps for me (create Vapi assistant, point webhook to ngrok URL, test call)

Stop after step 12. Do not add tests, deployment configs, Docker, CI/CD, Altegio integration, or any features beyond this list. If you think something is needed beyond this, ask me first.
