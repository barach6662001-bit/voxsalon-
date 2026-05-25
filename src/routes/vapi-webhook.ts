import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { VapiWebhookSchema } from "../types.js";
import { extractCallData } from "../services/parser.js";
import { summarizeCall } from "../services/summarizer.js";
import { sendCallSummary } from "../services/telegram.js";
import logger from "../services/logger.js";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";

async function ensureDataDir(): Promise<void> {
	try {
		await mkdir(join(process.cwd(), "data"), { recursive: true });
	} catch {
		// directory exists
	}
}

export async function vapiWebhookRoutes(fastify: FastifyInstance): Promise<void> {
	fastify.post("/webhook/vapi", async (req: FastifyRequest, reply: FastifyReply) => {
		logger.debug({ rawBody: req.body }, "Raw webhook payload");

		const parseResult = VapiWebhookSchema.safeParse(req.body);

		if (!parseResult.success) {
			logger.warn({ error: parseResult.error.format() }, "Invalid webhook payload");
			return reply.status(400).send({ ok: false, error: "Invalid payload" });
		}

		const body = parseResult.data;
		const m = body.message;

		logger.info({ type: m.type }, "Received Vapi webhook");

		if (m.type !== "end-of-call-report") {
			return reply.send({ ok: true });
		}

		const callerPhone = m.customer?.number ?? m.call?.customer?.number ?? "не вказано";
		const transcript = m.transcript ?? m.artifact?.transcript ?? "";
		const callId = m.call?.id ?? "unknown";
		const timestamp = new Date(m.call?.createdAt ?? Date.now());

		let parsed = extractCallData(transcript);

		if (m.analysis?.structuredData) {
			const sd = m.analysis.structuredData;
			if (sd.service) parsed.service = String(sd.service);
			if (sd.name) parsed.name = String(sd.name);
			if (sd.datetime) parsed.desiredTime = String(sd.datetime);
		}

		parsed.rawTranscript = transcript;

		let callSummary: { name: string; service: string; datetime: string; summary: string; keyPoints: string[]; actionItems: string[]; callerPhone: string; leftPhone: string } = {
			name: "не вказано",
			service: "не вказано",
			datetime: "не вказано",
			summary: transcript.slice(0, 200),
			keyPoints: [],
			actionItems: [],
			callerPhone: callerPhone,
			leftPhone: "не вказано",
		};
		if (transcript) {
			callSummary = await summarizeCall(transcript);
			// Use actual caller phone from webhook, leftPhone from AI
			callSummary.callerPhone = callerPhone;
		}

		try {
			await Promise.all([
				sendCallSummary({
					callerPhone: callSummary.callerPhone,
					leftPhone: callSummary.leftPhone,
					name: callSummary.name,
					service: callSummary.service,
					datetime: callSummary.datetime,
					summary: callSummary.summary,
					keyPoints: callSummary.keyPoints,
					actionItems: callSummary.actionItems,
					callId,
					timestamp,
				}),
				appendToLog(body),
			]);

			logger.info({ callId, callSummary }, "Processed end-of-call-report");
		} catch (err) {
			logger.error({ err, callId }, "Failed to process webhook");
		}

		return reply.send({ ok: true });
	});
}

async function appendToLog(payload: unknown): Promise<void> {
	await ensureDataDir();
	const logPath = join(process.cwd(), "data", "call_logs.jsonl");

	return new Promise((resolve, reject) => {
		const stream = createWriteStream(logPath, { flags: "a" });
		stream.write(JSON.stringify(payload) + "\n");
		stream.end(resolve);
		stream.on("error", reject);
	});
}
