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

try {
	await fastify.listen({ port: config.port, host: "0.0.0.0" });
	logger.info({ port: config.port, env: config.nodeEnv }, "VoxSalon server started");
} catch (err) {
	logger.error({ err }, "Failed to start server");
	process.exit(1);
}