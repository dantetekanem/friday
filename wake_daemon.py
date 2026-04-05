#!/usr/bin/env python3
"""
Friday Wake Word Daemon

Listens for a wake word using openwakeword, records speech after detection,
transcribes with faster-whisper, and writes the result to a command file
that the Friday pi extension picks up.

Usage:
    python3 wake_daemon.py <command_file> [--wake-word hey_jarvis] [--threshold 0.5]
"""

import argparse
import json
import logging
import sys
import time
import os
import struct
import tempfile
import signal
import numpy as np

# Audio config
SAMPLE_RATE = 16000
CHUNK_SIZE = 1280  # 80ms at 16kHz — openwakeword expects this
FORMAT_WIDTH = 2   # 16-bit
CHANNELS = 1

# Silence detection
SILENCE_THRESHOLD = 500      # RMS amplitude threshold for silence
SILENCE_DURATION = 2.0       # seconds of silence to stop recording
INITIAL_WAIT_SECONDS = 3.5   # seconds to wait for speech after wake word
MAX_RECORD_SECONDS = 30      # safety cap
MIN_RECORD_SECONDS = 0.5     # ignore very short recordings
MUTE_FILE_NAME = "tts_playing"  # skip detection while this file exists
LISTEN_NOW_FILE = "listen_now"  # extension signals: start recording immediately

logging.basicConfig(
    level=logging.INFO,
    format="[friday-wake] %(asctime)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("friday-wake")


def rms(audio_chunk: bytes) -> float:
    """Calculate RMS amplitude of a 16-bit audio chunk."""
    if len(audio_chunk) < 2:
        return 0.0
    count = len(audio_chunk) // 2
    shorts = struct.unpack(f"<{count}h", audio_chunk)
    return (sum(s * s for s in shorts) / count) ** 0.5


def record_until_silence(stream, sample_rate: int, chunk_size: int,
                         wait_for_speech: float = 0,
                         max_record: float = 0) -> bytes:
    """Record audio from stream until silence is detected.

    Args:
        wait_for_speech: Max seconds to wait for the user to START talking.
                         0 = start recording immediately (wake-word mode).
                         >0 = wait up to this many seconds for speech before giving up
                              (question-response mode).
        max_record: Max recording duration in seconds. 0 = use MAX_RECORD_SECONDS default.
    """
    effective_max = max_record if max_record > 0 else MAX_RECORD_SECONDS
    frames = []
    silent_chunks = 0
    chunks_for_silence = int(SILENCE_DURATION * sample_rate / chunk_size)
    max_chunks = int(effective_max * sample_rate / chunk_size)
    min_chunks = int(MIN_RECORD_SECONDS * sample_rate / chunk_size)

    # Phase 1: Wait for speech to begin (if wait_for_speech > 0)
    if wait_for_speech > 0:
        wait_chunks = int(wait_for_speech * sample_rate / chunk_size)
        log.info(f"Waiting up to {wait_for_speech:.0f}s for speech...")
        speech_started = False
        for _ in range(wait_chunks):
            data = stream.read(chunk_size, exception_on_overflow=False)
            amplitude = rms(data)
            if amplitude >= SILENCE_THRESHOLD:
                # Speech detected — keep this chunk and move to recording
                frames.append(data)
                speech_started = True
                break
        if not speech_started:
            log.info("No speech detected within wait window, giving up")
            return b""

    # Phase 2: Record until silence
    log.info("Recording... (speak now)")

    for i in range(max_chunks):
        data = stream.read(chunk_size, exception_on_overflow=False)
        frames.append(data)

        amplitude = rms(data)
        if amplitude < SILENCE_THRESHOLD:
            silent_chunks += 1
        else:
            silent_chunks = 0

        # Stop on sustained silence (but only after minimum recording time)
        if silent_chunks >= chunks_for_silence and i >= min_chunks:
            break

    duration = len(frames) * chunk_size / sample_rate
    log.info(f"Recorded {duration:.1f}s of audio")
    return b"".join(frames)


def transcribe(audio_bytes: bytes, model) -> str:
    """Transcribe raw 16-bit PCM audio bytes using faster-whisper."""
    # Convert bytes to float32 numpy array
    audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    segments, info = model.transcribe(
        audio_array,
        beam_size=5,
        language="en",
        vad_filter=True,
    )

    text = " ".join(segment.text.strip() for segment in segments).strip()
    return text


def write_signal(command_file: str, signal_type: str, text: str = ""):
    """Write a signal/command to the command file for the extension."""
    payload = json.dumps({"type": signal_type, "text": text, "timestamp": time.time()})
    tmp = command_file + ".tmp"
    with open(tmp, "w") as f:
        f.write(payload + "\n")
    os.rename(tmp, command_file)
    if text:
        log.info(f"Sent to pi: {text}")


def play_listening_sound():
    """Play a subtle sound to indicate we're listening."""
    # Quick beep using sox
    try:
        os.system("play -q -n synth 0.1 sin 800 vol 0.3 2>/dev/null &")
    except Exception:
        pass


def play_done_sound():
    """Play a subtle sound to indicate we're done recording."""
    try:
        os.system("play -q -n synth 0.05 sin 600 vol 0.2 2>/dev/null &")
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="Friday Wake Word Daemon")
    parser.add_argument("command_file", help="File to write transcribed commands to")
    parser.add_argument("--wake-word", default="hey_jarvis", help="Wake word model name")
    parser.add_argument("--threshold", type=float, default=0.5, help="Wake word detection threshold")
    parser.add_argument("--whisper-model", default="tiny.en", help="Whisper model size")
    parser.add_argument("--data-dir", default=None, help="Directory for custom wake word models")
    args = parser.parse_args()

    # Handle shutdown gracefully
    running = True
    def shutdown(sig, frame):
        nonlocal running
        log.info("Shutting down...")
        running = False
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Load wake word model
    log.info(f"Loading wake word model: {args.wake_word}")
    from openwakeword.model import Model as WakeModel

    # Check if it's a custom model file in the data dir
    data_dir = args.data_dir or os.path.join(os.path.expanduser("~"), ".pi/agent/friday")
    custom_model_path = os.path.join(data_dir, f"{args.wake_word}.onnx")
    if os.path.exists(custom_model_path):
        log.info(f"Using custom model: {custom_model_path}")
        model_ref = custom_model_path
    else:
        model_ref = args.wake_word

    wake_model = WakeModel(
        wakeword_models=[model_ref],
        inference_framework="onnx",
    )

    # Load whisper model
    log.info(f"Loading whisper model: {args.whisper_model}")
    from faster_whisper import WhisperModel
    whisper_model = WhisperModel(args.whisper_model, device="cpu", compute_type="int8")

    # Open microphone
    import pyaudio
    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK_SIZE,
    )

    log.info(f"Listening for '{args.wake_word}' (threshold: {args.threshold})...")
    log.info(f"Command file: {args.command_file}")

    # Log RMS levels periodically for mic diagnostics
    rms_sample_counter = 0
    rms_max_seen = 0

    try:
        while running:
            # Read audio chunk
            try:
                audio = stream.read(CHUNK_SIZE, exception_on_overflow=False)
            except Exception:
                time.sleep(0.01)
                continue

            # Convert to numpy for openwakeword
            audio_array = np.frombuffer(audio, dtype=np.int16)

            # Periodic RMS diagnostics (every ~2s)
            current_rms = rms(audio)
            if current_rms > rms_max_seen:
                rms_max_seen = current_rms
            rms_sample_counter += 1
            if rms_sample_counter % 25 == 0:  # ~2s at 80ms chunks
                log.info(f"[mic] RMS: {current_rms:.0f} | max seen: {rms_max_seen:.0f} | threshold: {SILENCE_THRESHOLD}")

            base_dir = os.path.dirname(args.command_file)

            # Skip detection while TTS is playing (prevents self-triggering)
            mute_path = os.path.join(base_dir, MUTE_FILE_NAME)
            if os.path.exists(mute_path):
                wake_model.reset()
                continue

            # Check if extension wants us to listen immediately (question asked)
            listen_now_path = os.path.join(base_dir, LISTEN_NOW_FILE)
            immediate_listen = False
            wait_for_speech = 0
            max_record = 0  # 0 = use MAX_RECORD_SECONDS default
            if os.path.exists(listen_now_path):
                try:
                    raw = open(listen_now_path).read().strip()
                    os.remove(listen_now_path)
                    immediate_listen = True
                    # Parse JSON payload for waitForSpeech parameter
                    try:
                        payload = json.loads(raw)
                        wait_for_speech = float(payload.get("waitForSpeech", 5))
                        max_record = float(payload.get("maxRecord", 10))
                    except (json.JSONDecodeError, ValueError):
                        wait_for_speech = 5
                        max_record = 10
                    log.info(f"Auto-listen triggered (wait={wait_for_speech:.0f}s, max_record={max_record:.0f}s)")
                except Exception:
                    pass

            if not immediate_listen:
                # Run wake word detection
                prediction = wake_model.predict(audio_array)
                score = prediction.get(args.wake_word, 0)
                if score < args.threshold:
                    continue

            if True:  # wake word detected OR immediate listen
                if not immediate_listen:
                    log.info(f"Wake word detected! (score: {score:.2f})")
                    # Signal extension IMMEDIATELY to kill any playing TTS
                    write_signal(args.command_file, "wake", "")

                play_listening_sound()

                # Reset the wake word model to avoid re-triggering
                wake_model.reset()

                # Record speech until silence
                # For auto-listen (questions), wait up to wait_for_speech seconds
                # for the user to start talking before giving up
                audio_data = record_until_silence(
                    stream, SAMPLE_RATE, CHUNK_SIZE,
                    wait_for_speech=wait_for_speech if immediate_listen else INITIAL_WAIT_SECONDS,
                    max_record=max_record if immediate_listen else MAX_RECORD_SECONDS,
                )
                play_done_sound()

                if len(audio_data) < SAMPLE_RATE * MIN_RECORD_SECONDS * FORMAT_WIDTH:
                    log.info("Recording too short, ignoring")
                    continue

                # Transcribe
                log.info("Transcribing...")
                text = transcribe(audio_data, whisper_model)

                if text and len(text.strip()) > 0:
                    write_signal(args.command_file, "command", text.strip())
                else:
                    log.info("No speech detected in recording")

    except KeyboardInterrupt:
        pass
    finally:
        log.info("Cleaning up...")
        stream.stop_stream()
        stream.close()
        pa.terminate()


if __name__ == "__main__":
    main()
