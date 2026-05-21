import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
	fastify.get("/health", async (_req: FastifyRequest, reply: FastifyReply) => {
		return reply.send({
			status: "ok",
			timestamp: new Date().toISOString(),
		});
	});
}
