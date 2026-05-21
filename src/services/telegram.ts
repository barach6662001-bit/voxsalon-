import TelegramBot from "node-telegram-bot-api";
import { config } from "../config.js";
import type { CallSummary } from "../types.js";
import logger from "./logger.js";

let bot: TelegramBot | null = null;

function getBot(): TelegramBot {
	if (!bot) {
		bot = new TelegramBot(config.telegram.botToken, { polling: false });
	}
	return bot;
}

interface TelegramPayload {
	phone: string;
	recordingUrl: string;
	summary: string;
	callId: string;
}

export async function sendCallSummary(
	payload: TelegramPayload,
	parsed: CallSummary,
): Promise<void> {
	const { phone, recordingUrl, summary, callId } = payload;

	const message = `📞 Новий пропущений дзвінок

👤 ${parsed.name || "не назвався"}
📱 ${phone}
💅 Послуга: ${parsed.service || "не вказано"}
📅 Бажаний час: ${parsed.desiredTime || "не вказано"}

📝 Запис: ${recordingUrl || "немає"}
📋 Підсумок: ${summary || "немає"}`;

	try {
		await getBot().sendMessage(config.telegram.ownerChatId, message, {
			parse_mode: "Markdown",
		});
		logger.info({ chatId: config.telegram.ownerChatId, callId }, "Telegram message sent");
	} catch (err) {
		logger.error({ err, callId }, "Failed to send Telegram message");
		throw err;
	}
}
