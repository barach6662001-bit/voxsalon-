import pino from "pino";
import { config } from "../config.js";

const logger = pino({
	level: config.nodeEnv === "production" ? "info" : "debug",
	transport: config.nodeEnv !== "production" ? { target: "pino-pretty" } : undefined,
});

export default logger;
