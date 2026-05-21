import { z } from "zod";

export const VapiWebhookSchema = z.object({
	message: z
		.object({
			type: z.string(),
			call: z
				.object({
					id: z.string(),
					startedAt: z.string().optional(),
					endedAt: z.string().optional(),
					customer: z.object({ number: z.string().optional() }).optional(),
				})
				.passthrough()
				.optional(),
			customer: z.object({ number: z.string().optional() }).optional(),
			transcript: z.string().optional(),
			summary: z.string().optional(),
			recordingUrl: z.string().optional(),
			endedReason: z.string().optional(),
			analysis: z
				.object({
					summary: z.string().optional(),
					structuredData: z.record(z.string(), z.any()).optional(),
				})
				.passthrough()
				.optional(),
			artifact: z
				.object({
					transcript: z.string().optional(),
					recordingUrl: z.string().optional(),
				})
				.passthrough()
				.optional(),
		})
		.passthrough(),
});

export type VapiWebhookPayload = z.infer<typeof VapiWebhookSchema>;

export interface CallSummary {
	name: string;
	phone: string;
	service: string;
	desiredTime: string;
	rawTranscript: string;
}
