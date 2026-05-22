import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { VapiWebhookSchema } from "../types.js";
import { extractCallData } from "../services/parser.js";
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
		const summary =
			m.analysis?.structuredData?.summary_uk ??
			m.summary ??
			m.analysis?.summary ??
			"";
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

		try {
			await Promise.all([
				sendCallSummary({ phone: callerPhone, summary, callId, timestamp }, parsed),
				appendToLog(body),
			]);

			logger.info({ callId }, "Processed end-of-call-report");
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
