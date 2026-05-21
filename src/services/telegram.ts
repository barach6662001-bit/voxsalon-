import TelegramBot from "node-telegram-bot-api";
import { config } from "../config.js";
import type { VapiPayload, CallSummary } from "../types.js";
import logger from "./logger.js";

let bot: TelegramBot | null = null;

function getBot(): TelegramBot {
	if (!bot) {
		bot = new TelegramBot(config.telegram.botToken, { polling: false });
	}
	return bot;
}

export async function sendCallSummary(payload: VapiPayload, parsed: CallSummary): Promise<void> {
	const call = payload.call;

	// Format timestamp
	const timestamp = call.startedAt
		? new Date(call.startedAt).toLocaleString("uk-UA", {
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "невідомо";

	// Truncate transcript preview
	const transcriptPreview = call.transcript
		? call.transcript.slice(0, 200) + (call.transcript.length > 200 ? "..." : "")
		: "немає";

	const message = `📞 Новий пропущений дзвінок

⏰ ${timestamp}
👤 ${parsed.name || "не назвався"}
📱 ${parsed.phone || "не вказано"}
💅 Послуга: ${parsed.service || "не вказано"}
📅 Бажаний час: ${parsed.desiredTime || "не вказано"}

📝 Запис: ${call.recordingUrl || "немає"}
📋 Початок розмови: ${transcriptPreview}`;

	try {
		await getBot().sendMessage(config.telegram.ownerChatId, message, {
			parse_mode: "Markdown",
		});
		logger.info({ chatId: config.telegram.ownerChatId }, "Telegram message sent");
	} catch (err) {
		logger.error({ err }, "Failed to send Telegram message");
		throw err;
	}
}
