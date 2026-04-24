/**
 * Friday Extension - Wake Word Daemon Module
 * Wake word daemon management, file watching, and voice command handling
 */

import { spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
const execAsync = promisify(execCb);
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FridaySettings } from "./settings.js";
import type { FSWatcher } from "node:fs";

export async function killOrphanDaemons(log: (msg: string) => void) {
	try {
		const { stdout } = await execAsync(
			"ps aux | grep wake_daemon.py | grep -v grep",
			{ encoding: "utf8", timeout: 5000 },
		);
		const result = stdout.trim();
		if (!result) return;
		for (const line of result.split("\n")) {
			const parts = line.trim().split(/\s+/);
			const pid = parseInt(parts[1]!, 10);
			if (!pid || isNaN(pid)) continue;
			try { 
				process.kill(pid, "SIGTERM"); 
				log(`Killed orphan wake daemon (PID ${pid})`); 
			} catch {}
		}
	} catch { /* no orphans found (grep exits 1) */ }
}

export function startWakeDaemon(
	settings: FridaySettings,
	commsDir: string,
	commandFile: string,
	log: (msg: string) => void,
	logError: (context: string, err: unknown) => void,
): ChildProcess | null {
	try {
		// Validate Python dependencies before spawning — avoids brief DAEMON ON flash
		// when the daemon crashes immediately due to missing modules
		try {
			const { execSync } = require("node:child_process");
			execSync('python3 -c "import openwakeword; import pyaudio"', {
				stdio: "ignore", timeout: 5000,
			});
		} catch {
			log("Wake daemon skipped — missing Python deps (openwakeword/pyaudio)");
			return null;
		}

		mkdirSync(commsDir, { recursive: true });

		const DAEMON_SCRIPT = join(
			import.meta.dirname,
			"wake_daemon.py",
		);

		const dataDir = join(process.env.HOME ?? "~", ".pi/agent/friday");

		const args = [
			DAEMON_SCRIPT,
			commandFile,
			"--wake-word", settings.wakeWord.model,
			"--threshold", String(settings.wakeWord.threshold),
			"--whisper-model", settings.wakeWord.whisperModel,
			"--data-dir", dataDir,
		];

		const wakeDaemon = spawn("python3", args, {
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
		});

		// Unref so the daemon doesn't keep the event loop alive on shutdown
		wakeDaemon.unref();

		wakeDaemon.stderr?.on("data", (data: Buffer) => {
			try { const line = data.toString().trim(); if (line) log(line); } catch {}
		});

		wakeDaemon.on("exit", (code) => {
			try {
				log(`Wake daemon exited (code: ${code})`);
			} catch (e) { logError("wakeDaemon.exit", e); }
		});

		log("Wake daemon started");
		return wakeDaemon;
	} catch (e) { 
		logError("startWakeDaemon", e); 
		return null;
	}
}

export function stopWakeDaemon(wakeDaemon: ChildProcess | null, logError: (context: string, err: unknown) => void) {
	try {
		if (wakeDaemon) {
			// Destroy stdio streams so they don't hold the event loop
			try { wakeDaemon.stdout?.destroy(); } catch {}
			try { wakeDaemon.stderr?.destroy(); } catch {}
			// SIGKILL for instant death on shutdown
			wakeDaemon.kill("SIGKILL");
		}
	} catch (e) { logError("stopWakeDaemon", e); }
}

export function startWakeWatcher(
	commandFile: string,
	lastCommandTimestamp: { value: number },
	killCurrentVoice: () => void,
	handleWakeCommand: (text: string) => void,
	logError: (context: string, err: unknown) => void,
): any {
	try {
		// CRITICAL FIX: Add .unref() to background interval timer
		const interval = setInterval(() => {
			try {
				if (!existsSync(commandFile)) return;
				const raw = readFileSync(commandFile, "utf8").trim();
				if (!raw) return;
				const cmd = JSON.parse(raw);
				if (!cmd.timestamp || cmd.timestamp <= lastCommandTimestamp.value) return;
				lastCommandTimestamp.value = cmd.timestamp;

				if (cmd.type === "wake") {
					killCurrentVoice();
				} else if (cmd.type === "command" && cmd.text) {
					handleWakeCommand(cmd.text);
				}
			} catch { /* ignore parse errors on partial writes */ }
		}, 100).unref();
		
		return { close: () => clearInterval(interval) } as any;
	} catch (e) { 
		logError("startWakeWatcher", e);
		return null; 
	}
}

export function stopWakeWatcher(wakeWatcher: any, logError: (context: string, err: unknown) => void) {
	try {
		if (wakeWatcher) {
			wakeWatcher.close?.();
		}
	} catch (e) { logError("stopWakeWatcher", e); }
}

export function handleWakeCommand(
	text: string, 
	pi: ExtensionAPI,
	log: (msg: string) => void,
	logError: (context: string, err: unknown) => void,
) {
	try {
		log(`Voice command: ${text}`);
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	} catch (e) {
		// This is the most critical catch — sendUserMessage throws when
		// the agent is already processing and deliverAs isn't accepted.
		// We MUST swallow this or it kills the host agent.
		logError("handleWakeCommand", e);
	}
}

export function isDaemonAlive(wakeDaemon: ChildProcess | null): boolean {
	if (!wakeDaemon || !wakeDaemon.pid) return false;
	try { process.kill(wakeDaemon.pid, 0); return true; } catch { return false; }
}