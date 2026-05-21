import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
	PORT: z.string().default("3000"),
	NODE_ENV: z.string().default("development"),
	VAPI_API_KEY: z.string().min(1),
	VAPI_WEBHOOK_SECRET: z.string().optional(),
	VAPI_ASSISTANT_ID: z.string().min(1),
	TELEGRAM_BOT_TOKEN: z.string().min(1),
	TELEGRAM_OWNER_CHAT_ID: z.string().min(1),
	PUBLIC_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error("❌ Invalid environment variables:");
	console.error(parsed.error.format());
	process.exit(1);
}

export const config = {
	port: parseInt(parsed.data.PORT, 10),
	nodeEnv: parsed.data.NODE_ENV,
	vapi: {
		apiKey: parsed.data.VAPI_API_KEY,
		webhookSecret: parsed.data.VAPI_WEBHOOK_SECRET ?? "",
		assistantId: parsed.data.VAPI_ASSISTANT_ID,
	},
	telegram: {
		botToken: parsed.data.TELEGRAM_BOT_TOKEN,
		ownerChatId: parsed.data.TELEGRAM_OWNER_CHAT_ID,
	},
	publicBaseUrl: parsed.data.PUBLIC_BASE_URL,
};
