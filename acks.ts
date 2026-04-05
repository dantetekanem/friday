/**
 * Friday Extension - Acknowledgment System Module
 * Acknowledgment phrases, classification, scheduling, and delivery
 */

import type { ChildProcess } from "node:child_process";
import type { FridaySettings } from "./settings.js";

export const PANEL_PHRASES = [
	`Full details in the panel.`,
	`More in the panel if you need it.`,
	`Rest is on screen.`,
	`Details on your screen.`,
];

export type AckCategory = "investigate" | "build" | "research" | "fix" | "general" | "question";

export const ACK_PHRASES: Record<AckCategory, string[]> = {
	investigate: [
		"Looking into it.", "Let me check.", "Starting the investigation.",
		"Pulling up the details now.", "Let me trace through that.",
		"On it. Give me a moment.", "Checking that now.",
	],
	build: [
		"On it.", "Starting now.", "I'll get that set up.",
		"Building it out.", "Consider it started.",
		"Spinning that up now.", "Alright, putting it together.",
	],
	research: [
		"Let me look that up.", "Searching now.", "I'll find out.",
		"Running a search.", "Let me dig into that.", "Pulling up what I can find.",
	],
	fix: [
		"I see the issue. Working on it.", "Let me patch that up.",
		"On it. Should have a fix shortly.", "Addressing that now.",
		"I'll sort that out.", "Fixing it.",
	],
	general: [
		"Copy that.", "Understood.", "Right away.", "Working on it.",
		"One moment.", "Got it.", "Acknowledged.", "Processing.",
	],
	question: [
		"One sec.", "Let me check.", "I'll look into that.",
		"Let me see.", "Hmm, let me think.", "Good question. Let me check.",
		"Let me find out.", "Checking.",
	],
};

export const ACK_PATTERNS: { pattern: RegExp; category: AckCategory }[] = [
	{ pattern: /\b(investigat|diagnos|debug|check|look into|what.s wrong|why is|trace)\b/i, category: "investigate" },
	{ pattern: /\b(fix|repair|patch|resolve|broken|bug|error|fail|crash)\b/i, category: "fix" },
	{ pattern: /\b(search|find|research|look up|compare|what are|which|best|recommend)\b/i, category: "research" },
	{ pattern: /\b(build|create|add|implement|make|set up|write|generate|scaffold|deploy)\b/i, category: "build" },
];

export function hasUnquotedQuestionMark(text: string): boolean {
	// Strip quoted/backticked content, then check for ?
	const stripped = text
		.replace(/`[^`]*`/g, "")
		.replace(/"[^"]*"/g, "")
		.replace(/'[^']*'/g, "");
	return stripped.includes("?");
}

export function classifyPrompt(text: string): AckCategory {
	if (hasUnquotedQuestionMark(text)) return "question";
	for (const { pattern, category } of ACK_PATTERNS) {
		if (pattern.test(text)) return category;
	}
	return "general";
}

export function pickAck(
	category: AckCategory,
	lastAckCategory: { value: AckCategory | null },
	lastAckIndex: { value: number },
): string {
	const phrases = ACK_PHRASES[category];
	let idx: number;
	do {
		idx = Math.floor(Math.random() * phrases.length);
	} while (idx === lastAckIndex.value && category === lastAckCategory.value && phrases.length > 1);
	lastAckCategory.value = category;
	lastAckIndex.value = idx;
	return phrases[idx]!;
}

export function pickPanelPhrase(): string {
	return PANEL_PHRASES[Math.floor(Math.random() * PANEL_PHRASES.length)]!;
}

export function cancelAck(ackTimer: { value: ReturnType<typeof setTimeout> | null }) {
	try {
		if (ackTimer.value) { 
			clearTimeout(ackTimer.value); 
			ackTimer.value = null; 
		}
	} catch {}
}

export function scheduleAck(
	prompt: string,
	ackTimer: { value: ReturnType<typeof setTimeout> | null },
	lastMessageWasQuestion: { value: boolean },
	lastAgentEndTime: number,
	interactionCount: { value: number },
	lastAckCategory: { value: AckCategory | null },
	lastAckIndex: { value: number },
	showAndSpeak: (text: string) => void,
	logError: (context: string, err: unknown) => void,
) {
	try {
		cancelAck(ackTimer);
		const ackCancelled = { value: false };

		if (lastMessageWasQuestion.value) {
			lastMessageWasQuestion.value = false;
			return;
		}

		const now = Date.now();
		const MOMENTUM_WINDOW_MS = 30000;
		const inMomentum = (now - lastAgentEndTime) < MOMENTUM_WINDOW_MS;

		if (inMomentum) {
			interactionCount.value++;
		} else {
			interactionCount.value = 0;
		}

		if (interactionCount.value >= 3) return;
		if (interactionCount.value > 0 && Math.random() > 1 / (interactionCount.value + 1)) return;

		const category = classifyPrompt(prompt);
		const ack = pickAck(category, lastAckCategory, lastAckIndex);

		const ACK_DELAY_MS = 2000;
		// CRITICAL FIX: Add .unref() to ack timer
		ackTimer.value = setTimeout(() => {
			try {
				if (ackCancelled.value) return;
				showAndSpeak(ack);
			} catch (e) { logError("ackTimer.callback", e); }
		}, ACK_DELAY_MS).unref();
	} catch (e) { logError("scheduleAck", e); }
}

export function showAndSpeak(
	text: string,
	voiceEnabled: boolean,
	ensurePanelOpen: () => Promise<boolean>,
	writeMessage: (text: string) => void,
	enqueueVoiceWithMessage: (text: string, speed?: number) => void,
	settings: FridaySettings,
	logError: (context: string, err: unknown) => void,
) {
	try {
		if (voiceEnabled) {
			enqueueVoiceWithMessage(text, settings.voice.speed);
		} else {
			ensurePanelOpen().then((ok) => {
				try { if (ok) writeMessage(text); } catch (e) { logError("showAndSpeak.panel", e); }
			}).catch((e) => logError("showAndSpeak.ensurePanel", e));
		}
	} catch (e) { logError("showAndSpeak", e); }
}