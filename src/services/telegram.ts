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
	name: string;
	service: string;
	datetime: string;
	summary: string;
	keyPoints: string[];
	actionItems: string[];
	callId: string;
	timestamp: Date;
}

export async function sendCallSummary(payload: TelegramPayload): Promise<void> {
	const { phone, name, service, datetime, summary, keyPoints, actionItems, callId, timestamp } = payload;

	const formattedDate = timestamp.toLocaleDateString("uk-UA", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
	const formattedTime = timestamp.toLocaleTimeString("uk-UA", {
		hour: "2-digit",
		minute: "2-digit",
	});

	const keyPointsText = keyPoints.length > 0
		? `\n📌 Ключові моменти:\n${keyPoints.map(p => `• ${p}`).join("\n")}`
		: "";

	const actionItemsText = actionItems.length > 0
		? `\n✅ Потрібно зробити:\n${actionItems.map(a => `• ${a}`).join("\n")}`
		: "";

	const message = `📞 Новий пропущений дзвінок

⏰ ${formattedDate} ${formattedTime}
📱 ${phone}
👤 Ім'я: ${name}
💅 Послуга: ${service}
📅 Бажаний час: ${datetime}

📋 ${summary}${keyPointsText}${actionItemsText}`;

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
