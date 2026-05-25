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
	callerPhone: string;
	leftPhone: string;
}

const SYSTEM_PROMPT = `Ти - адміністратор косметологічного кабінету. Проаналізуй транскрипт дзвінка та поверни ТІЛЬКИ сирий JSON (БЕЗ маркап-блоків, БЕЗ кодових блоків).

Формат JSON:
{
  "name": "ім'я клієнта українською, або 'не вказано'",
  "service": "послуга/процедура яка цікавить, або 'не вказано'",
  "datetime": "бажана дата і час візиту, або 'не вказано'",
  "callerPhone": "номер телефону з якого дзвонили, або 'не вказано'",
  "leftPhone": "номер телефону який клієнт залишив (може відрізнятися від callerPhone), або 'не вказано'",
  "summary": "короткий підсумок: що сталось, який результат дзвінка (1-2 речення)",
  "keyPoints": ["короткий пункт 1", "короткий пункт 2"],
  "actionItems": ["конкретна дія для адміністратора 1", "конкретна дія 2"]
}

ПРАВИЛА:
- summary має бути КОРОТКИМ підсумком результату дзвінка, НЕ переказом діалогу
- keyPoints: головне з розмови (запит, уточнення, важливі деталі)
- actionItems: що адміністратор має зробити (передзвонити, записати, уточнити)
- Обидва телефони - окремо! callerPhone і leftPhone можуть бути різними
- Всі значення - українською мовою`;

export async function summarizeCall(transcript: string): Promise<CallSummary> {
	const fallback: CallSummary = {
		name: "не вказано",
		service: "не вказано",
		datetime: "не вказано",
		summary: transcript.slice(0, 200),
		actionItems: [],
		keyPoints: [],
		callerPhone: "не вказано",
		leftPhone: "не вказано",
	};

	if (!transcript.trim()) {
		return fallback;
	}

	try {
		const msg = await client.messages.create({
			model: config.anthropic.summaryModel,
			max_tokens: 800,
			system: SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: transcript,
				},
			],
		});

		const text = msg.content.find((block) => block.type === "text");
		if (!text || text.type !== "text") {
			return fallback;
		}

		let rawText = text.text.trim();
		// Remove markdown code blocks if present
		rawText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

		const parsed = JSON.parse(rawText) as Partial<CallSummary>;
		return {
			name: parsed.name ?? "не вказано",
			service: parsed.service ?? "не вказано",
			datetime: parsed.datetime ?? "не вказано",
			summary: parsed.summary ?? "не вказано",
			keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
			actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
			callerPhone: parsed.callerPhone ?? "не вказано",
			leftPhone: parsed.leftPhone ?? "не вказано",
		};
	} catch (err) {
		logger.error({ err, transcript: transcript.slice(0, 100) }, "Failed to summarize call");
		return fallback;
	}
}