import TelegramBot from "node-telegram-bot-api";
import { config } from "../config.js";
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
	summary: string;
	callId: string;
	timestamp: Date;
}

export async function sendCallSummary(
	payload: TelegramPayload,
): Promise<void> {
	const { phone, summary, callId, timestamp } = payload;

	const formattedDate = timestamp.toLocaleDateString("uk-UA", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
	const formattedTime = timestamp.toLocaleTimeString("uk-UA", {
		hour: "2-digit",
		minute: "2-digit",
	});

	const message = `📞 Новий пропущений дзвінок

⏰ ${formattedDate} ${formattedTime}
📱 ${phone}

${summary || "немає підсумку"}`;

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
