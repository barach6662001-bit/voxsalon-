import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import logger from "./services/logger.js";
import { healthRoutes } from "./routes/health.js";
import { vapiWebhookRoutes } from "./routes/vapi-webhook.js";

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

fastify.get("/debug/test-fetch", async (_req, reply) => {
	// Test with x-api-key header (gym-rat format)
	try {
		const response = await fetch("https://gym-rat.online/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": config.anthropic.apiKey,
				"Content-Type": "application/json",
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: config.anthropic.summaryModel,
				max_tokens: 50,
				messages: [{ role: "user", content: "say hi" }],
			}),
		});

		const data = await response.text();
		return reply.send({ status: response.status, data: data.slice(0, 500) });
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
