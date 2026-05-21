import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { VapiPayloadSchema } from "../types.js";
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
		const parseResult = VapiPayloadSchema.safeParse(req.body);

		if (!parseResult.success) {
			logger.warn({ error: parseResult.error.format() }, "Invalid webhook payload");
			return reply.status(400).send({ ok: false, error: "Invalid payload" });
		}

		const payload = parseResult.data;

		if (payload.type === "end-of-call-report") {
			try {
				const parsed = extractCallData(payload.call.transcript ?? "");

				await Promise.all([sendCallSummary(payload, parsed), appendToLog(payload)]);

				logger.info({ callId: payload.call.id }, "Processed end-of-call-report");
			} catch (err) {
				logger.error({ err, callId: payload.call.id }, "Failed to process webhook");
			}
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
