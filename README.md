# VoxSalon

AI voice receptionist for Ukrainian cosmetology clinics. Answers missed calls in Ukrainian, sends a Telegram summary to the owner.

## Status

V0 / MVP — answers calls, sends summaries. No automatic booking yet (owner confirms manually).

## Quick start

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- ngrok (`brew install ngrok` or download from ngrok.com)
- A Vapi account (vapi.ai)
- A Telegram account
- An OpenAI API key (used by Vapi for LLM)

### Setup

1. Clone this repo and install dependencies:
   ```bash
   git clone <your-repo-url>
   cd voxsalon
   pnpm install
   ```

2. Copy env template and fill in keys:
   ```bash
   cp .env.example .env
   # edit .env with your editor
   ```

3. Create a Telegram bot:
   - Open Telegram, search `@BotFather`
   - Send `/newbot`, choose name + username
   - Copy the token into `TELEGRAM_BOT_TOKEN`
   - Message your new bot once (any message)
   - Search `@userinfobot` and message it to get your chat ID
   - Put chat ID in `TELEGRAM_OWNER_CHAT_ID`

4. Set up Vapi assistant:
   - Sign up at https://dashboard.vapi.ai
   - Create an assistant (use the Ukrainian system prompt from `CLAUDE.md`)
   - Choose ElevenLabs voice — pick a Ukrainian female voice
   - Choose OpenAI gpt-4o or gpt-4o-mini as the model
   - Get a phone number (Vapi provisions via Twilio)
   - Copy API key, assistant ID, phone number ID into `.env`

5. Run the server:
   ```bash
   # Terminal 1: start ngrok tunnel
   pnpm tunnel
   # Copy the https URL it gives you

   # Terminal 2: start dev server
   pnpm dev
   ```

6. Configure Vapi webhook:
   - In Vapi dashboard, find your assistant
   - Set Server URL to `<your-ngrok-url>/webhook/vapi`
   - Save

7. Test it:
   - Call your Vapi phone number from your real phone
   - Speak to the AI in Ukrainian — say you want to make an appointment
   - After hanging up, check your Telegram — you should receive a summary

## Deployment

For production:
- Deploy to Vercel, fly.io, or Railway
- Update Vapi server URL from ngrok to production URL
- Set env vars in deployment platform

## Project structure

See `CLAUDE.md` for full project context and conventions.

## Next steps

After V0 works:
1. Move call logs from JSONL to Supabase
2. Add Altegio API integration for automatic booking
3. Build minimal web dashboard for the owner
4. Add multi-tenancy (one server, multiple salons)
