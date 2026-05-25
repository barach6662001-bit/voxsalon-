import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import logger from "./services/logger.js";
import { healthRoutes } from "./routes/health.js";
import { vapiWebhookRoutes } from "./routes/vapi-webhook.js";
import Anthropic from "@anthropic-ai/sdk";

const fastify = Fastify({
	logger: false,
});

await fastify.register(sensible);
await fastify.register(healthRoutes);
await fastify.register(vapiWebhookRoutes);

fastify.get("/debug/env", async (_req, reply) => {
	return reply.send({
		hasApiKey: !!config.anthropic.apiKey,
		hasBaseUrl: !!config.anthropic.baseUrl,
		baseUrl: config.anthropic.baseUrl,
		model: config.anthropic.summaryModel,
	});
});

fastify.get("/debug/test-anthropic", async (_req, reply) => {
	const client = new Anthropic({
		apiKey: config.anthropic.apiKey,
		...(config.anthropic.baseUrl ? { baseURL: config.anthropic.baseUrl } : {}),
	});

	try {
		const msg = await client.messages.create({
			model: config.anthropic.summaryModel,
			max_tokens: 50,
			messages: [{ role: "user", content: "say hi" }],
		});
		return reply.send({ success: true, response: msg.content });
	} catch (err: unknown) {
		const error = err as Error;
		return reply.send({ success: false, error: error.message });
	}
});

try {
	await fastify.listen({ port: config.port, host: "0.0.0.0" });
	logger.info({ port: config.port, env: config.nodeEnv }, "VoxSalon server started");
} catch (err) {
	logger.error({ err }, "Failed to start server");
	process.exit(1);
}
