import type { CallSummary } from "../types.js";

// Ukrainian service keywords
const SERVICE_KEYWORDS = [
	"бікіні",
	"депіляція",
	"макіяж",
	"манікюр",
	"педикюр",
	"обличчя",
	"чистка",
	"пілінг",
	"маска",
	"брови",
	"ламінування",
	"нарощування",
	" стрижка",
	"фарбування",
];

// Ukrainian name patterns
const NAME_PATTERNS = [
	/(?:мен(?:е|і)|я)\s+(?:з(?:вати|ву)|(?:буду\s+)?називати(?:ся)?)\s+([А-Яа-яЄєЇїІіҐґ]+)/i,
	/(?:це\s+)?([А-Яа-яЄєЇїІіҐґ]{2,})\s+(?:говор(?:ить|ю))/i,
];

// Ukrainian phone patterns
const PHONE_PATTERN = /\+?[0-9\s\-()]{10,}/;

// Ukrainian date/time patterns
const DATETIME_PATTERNS = [
	/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\s*(?:о\s+)?(\d{1,2})(?::(\d{2}))?/,
	/(?:на\s+)?(понеділок|вівторок|середа|четвер|п'ятниця|субота|неділя)/i,
	/(?:на\s+)?(сьогодні|завтра| післязавтра)/i,
];

export function extractCallData(transcript: string): CallSummary {
	const result: CallSummary = {
		name: "",
		phone: "",
		service: "",
		desiredTime: "",
		rawTranscript: transcript,
	};

	if (!transcript) {
		return result;
	}

	// Extract name
	for (const pattern of NAME_PATTERNS) {
		const match = transcript.match(pattern);
		if (match && match[1]) {
			result.name = match[1];
			break;
		}
	}

	// Extract phone
	const phoneMatch = transcript.match(PHONE_PATTERN);
	if (phoneMatch) {
		result.phone = phoneMatch[0].replace(/\s+/g, "").trim();
	}

	// Extract service
	const lowerTranscript = transcript.toLowerCase();
	for (const keyword of SERVICE_KEYWORDS) {
		if (lowerTranscript.includes(keyword)) {
			result.service = keyword.charAt(0).toUpperCase() + keyword.slice(1);
			break;
		}
	}

	// Extract desired time
	for (const pattern of DATETIME_PATTERNS) {
		const match = transcript.match(pattern);
		if (match) {
			result.desiredTime = match[0];
			break;
		}
	}

	return result;
}
