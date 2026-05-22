import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import logger from "./logger.js";

const client = new Anthropic({
	apiKey: config.anthropic.apiKey,
});

export async function generateUkrainianSummary(transcript: string): Promise<string> {
	try {
		const msg = await client.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 200,
			system:
				"Ти - адміністратор косметологічного кабінету. Твоє завдання - коротко підсумувати запис телефонної розмови українською мовою. Напиши 1-2 речення які містять: яку послугу хоче клієнт, бажаний час, ім'я клієнта, номер телефону. Якщо якась інформація відсутня - не згадуй її. Відповідай ТІЛЬКИ українською.",
			messages: [
				{
					role: "user",
					content: transcript,
				},
			],
		});

		const text = msg.content[0];
		if (text.type === "text") {
			return text.text;
		}
		return "";
	} catch (err) {
		logger.error({ err }, "Failed to generate Ukrainian summary");
		return "";
	}
}