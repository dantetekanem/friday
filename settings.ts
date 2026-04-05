/**
 * Friday Extension - Settings Management
 * Pure settings interface, defaults, and load/save functions
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FridaySettings {
	name: string;
	voice: {
		enabled: boolean;
		model: string;
		speed: number;
	};
	wakeWord: {
		enabled: boolean;
		model: string;
		threshold: number;
		whisperModel: string;
	};
	typewriter: {
		enabled: boolean;
	};
	panelWidth: number;
}

export const DEFAULT_SETTINGS: FridaySettings = {
	name: "Friday",
	voice: {
		enabled: false,
		model: "en_GB-jenny_dioco-medium",
		speed: 1.0,
	},
	wakeWord: {
		enabled: false,
		model: "hey_jarvis",
		threshold: 0.5,
		whisperModel: "tiny.en",
	},
	typewriter: {
		enabled: true,
	},
	panelWidth: 30,
};

export function getSettingsPath(): string {
	return join(
		process.env.HOME ?? "~",
		".pi/agent/extensions/friday/settings.json",
	);
}

export function loadSettings(): FridaySettings {
	const path = getSettingsPath();
	try {
		if (existsSync(path)) {
			const raw = JSON.parse(readFileSync(path, "utf8"));
			return {
				...DEFAULT_SETTINGS,
				...raw,
				voice: { ...DEFAULT_SETTINGS.voice, ...(raw.voice ?? {}) },
				wakeWord: { ...DEFAULT_SETTINGS.wakeWord, ...(raw.wakeWord ?? {}) },
				typewriter: { ...DEFAULT_SETTINGS.typewriter, ...(raw.typewriter ?? {}) },
			};
		}
	} catch { /* use defaults */ }
	return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: FridaySettings): void {
	try { 
		writeFileSync(getSettingsPath(), JSON.stringify(s, null, 2) + "\n"); 
	} catch {}
}