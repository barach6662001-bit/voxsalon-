import { z } from "zod";

const VapiCallSchema = z.object({
	id: z.string(),
	startedAt: z.string(),
	endedAt: z.string().optional(),
	customer: z
		.object({
			number: z.string().optional(),
		})
		.optional(),
	transcript: z.string().optional(),
	recordingUrl: z.string().url().optional(),
	summary: z.string().optional(),
});

export const VapiPayloadSchema = z.object({
	type: z.literal("end-of-call-report"),
	call: VapiCallSchema,
});

export type VapiPayload = z.infer<typeof VapiPayloadSchema>;

export interface CallSummary {
	name: string;
	phone: string;
	service: string;
	desiredTime: string;
	rawTranscript: string;
}

export type { VapiPayload as VapiWebhookPayload };
