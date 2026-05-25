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
}

export async function summarizeCall(transcript: string): Promise<CallSummary> {
	const fallback: CallSummary = {
		name: "не вказано",
		service: "не вказано",
		datetime: "не вказано",
		summary: transcript.slice(0, 200),
	};

	if (!transcript.trim()) {
		return fallback;
	}

	try {
		const msg = await client.messages.create({
			model: config.anthropic.summaryModel,
			max_tokens: 400,
			system:
				"Ти - адміністратор косметологічного кабінету. Проаналізуй транскрипт телефонної розмови та поверни ТІЛЬКИ сирий JSON (БЕЗ маркап-блоків) з такими ключами:\n- name: ім'я клієнта українською, або 'не вказано'\n- service: яка послуга/процедура цікавить клієнта, або 'не вказано'\n- datetime: бажана дата і час візиту, або 'не вказано'\n- summary: підсумок дзвінка 1-2 речення українською\nВсі значення - українською мовою.",
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
		};
	} catch (err) {
		logger.error({ err }, "Failed to summarize call");
		return fallback;
	}
}
