import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import logger from "./logger.js";

const client = new Anthropic({
	apiKey: config.anthropic.apiKey,
	...(config.anthropic.baseUrl ? { baseURL: config.anthropic.baseUrl } : {}),
	defaultHeaders: {
		"anthropic-version": "2023-06-01",
	},
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

const SYSTEM_PROMPT = `Ти - адміністратор косметологічного кабінету. Твоє завдання - проаналізувати транскрипт дзвінка і повернути JSON з результатами.

ВИХІДНИЙ ФОРМАТ (тільки JSON, без будь-яких додаткових символів):
{"name":"Оля","service":"чистка обличчя","datetime":"26.05.2026 14:00","callerPhone":"0671234567","leftPhone":"0671234567","summary":"Клієнт записується на чистку обличчя","keyPoints":["Клієнт: Оля","Телефон: 0671234567","Послуга: чистка обличчя"],"actionItems":["Передзвонити для підтвердження запису","Записати на чистку обличчя"]}

ПРАВИЛА:
1. Поверни ТІЛЬКИ сирий JSON - без кодових блоків, без markdown, без пояснень
2. name: ім'я клієнта українською, або "не вказано"
3. service: яка послуга цікавить, або "не вказано"
4. datetime: бажана дата і час у форматі "DD.MM.YYYY HH:mm", або "не вказано"
5. callerPhone: номер телефону звідки дзвонили, або "не вказано"
6. leftPhone: номер який клієнт залишив (може відрізнятися), або "не вказано"
7. summary: ОДНИМ реченням - результат дзвінка (не переказ!)
8. keyPoints: масив коротких фактів з розмови
9. actionItems: масив конкретних дій для адміністратора
10. Всі значення українською`;

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

	logger.info({
		baseUrl: config.anthropic.baseUrl,
		model: config.anthropic.summaryModel,
	}, "Calling Anthropic API");

	try {
		const msg = await client.messages.create({
			model: config.anthropic.summaryModel,
			max_tokens: 1000,
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
			logger.warn({ content: msg.content }, "No text block in AI response");
			return fallback;
		}

		let rawText = text.text.trim();
		// Remove markdown code blocks if present
		rawText = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

		logger.info({ rawText }, "AI response raw text");

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
	} catch (err: unknown) {
		const error = err as Error;
		logger.error({ err: error.message, transcript: transcript.slice(0, 100) }, "Failed to summarize call");
		return fallback;
	}
}