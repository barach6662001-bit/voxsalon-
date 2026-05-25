import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import logger from "./logger.js";

const client = new Anthropic({
	apiKey: config.anthropic.apiKey,
	...(config.anthropic.baseUrl ? { baseURL: config.anthropic.baseUrl } : {}),
});

interface CallSummary {
	name: string;
	service: string;
	datetime: string;
	summary: string;
	actionItems: string[];
	keyPoints: string[];
}

export async function summarizeCall(transcript: string): Promise<CallSummary> {
	const fallback: CallSummary = {
		name: "не вказано",
		service: "не вказано",
		datetime: "не вказано",
		summary: transcript.slice(0, 200),
		actionItems: [],
		keyPoints: [],
	};

	if (!transcript.trim()) {
		return fallback;
	}

	try {
		const msg = await client.messages.create({
			model: config.anthropic.summaryModel,
			max_tokens: 600,
			system:
				"Ти - адміністратор косметологічного кабінету. Проаналізуй транскрипт дзвінка та поверни ТІЛЬКИ сирий JSON (БЕЗ маркап-блоків).\n\nФормат:\n{\n  \"name\": \"ім'я клієнта українською, або 'не вказано'\",\n  \"service\": \"послуга/процедура яка цікавить, або 'не вказано'\",\n  \"datetime\": \"бажана дата і час візиту, або 'не вказано'\",\n  \"summary\": \"стислий підсумок: що сталось, який результат дзвінка (1-2 речення)\",\n  \"keyPoints\": [\"короткий пункт 1\", \"короткий пункт 2\", \"...\"],\n  \"actionItems\": [\"що потрібно зробити після дзвінка - конкретна дія\"]\n}\n\nkeyPoints: головне з розмови — запит клієнта, уточнення, важливі деталі (ім'я, телефон, опис проблеми).\nactionItems: конкретні дії для адміністратора — передзвонити, записати на дату, уточнити ціну, тощо.\nВсі значення - українською мовою.",
			messages: [
				{
					role: "user",
					content: transcript,
				},
			],
		});

		const text = msg.content[0];
		if (text.type !== "text") {
			return fallback;
		}

		const parsed = JSON.parse(text.text.trim()) as Partial<CallSummary>;
		return {
			name: parsed.name ?? "не вказано",
			service: parsed.service ?? "не вказано",
			datetime: parsed.datetime ?? "не вказано",
			summary: parsed.summary ?? "не вказано",
			keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
			actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
		};
	} catch (err) {
		logger.error({ err }, "Failed to summarize call");
		return fallback;
	}
}
