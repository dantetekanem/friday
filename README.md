# Friday

A [pi](https://github.com/nichochar/pi) package that adds a voice-enabled communications side panel. All conversation routes to a dedicated tmux pane with typewriter effect, text-to-speech, and hands-free voice input via wake word detection.

## Installation

```bash
pi install npm:pi-friday
```

Or from git:

```bash
pi install git:github.com/dantetekanem/friday
```

To try without installing:

```bash
pi -e npm:pi-friday
```

## Requirements

**Required** (the extension will not load without these):

- **tmux** — pi already requires this
- **perl** — pre-installed on macOS

**Optional — Voice output** (TTS):

- **piper-tts** — `pip3 install piper-tts`
- **sox** — `brew install sox` (provides the `play` command)
- A Piper voice model in `~/.local/share/piper-voices/` (see [Voices](#voices) below)

Without piper-tts and sox, voice output is disabled. The panel still works for text.

**Optional — Voice input** (wake word + transcription):

- **openwakeword** — `pip3 install openwakeword`
- **faster-whisper** — `pip3 install faster-whisper`
- **pyaudio** — `pip3 install pyaudio` (requires `brew install portaudio`)
- **sounddevice** + **numpy** — `pip3 install sounddevice numpy`

Without these, the wake word listener (`/friday listen`, `Alt+L`) is unavailable.

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+M` | Toggle voice on/off |
| `Alt+L` | Toggle wake word listener on/off |

## Commands

| Command | Action |
|---------|--------|
| `/friday` | Toggle the extension on/off |
| `/friday voice` | Toggle voice output |
| `/friday listen` | Toggle wake word listener |
| `/friday settings` | Show current configuration |

The status bar shows active modes: `FRIDAY`, `VOICE`, `DAEMON ON`.

## Wake Word

Say the configured wake word (default: "hey friday") to activate hands-free voice input. After detection, Friday records your speech, transcribes it locally with faster-whisper, and sends it as a message to pi.

Friday looks for custom wake word models in `~/.pi/agent/friday/`. To set up the default "hey friday" wake word:

1. Visit [openwakeword.com/library](https://openwakeword.com/library) (free, requires sign-in)
2. Search for **"hey friday"**
3. Download the `.onnx` file to `~/.pi/agent/friday/`
4. Set `wakeWord.model` in `settings.json` to the filename without `.onnx`

You can use any custom wake word — just download its `.onnx` model to the same directory.

Built-in models (no download needed): `alexa`, `hey_mycroft`, `hey_jarvis`, `hey_rhasspy`, `timer`, `weather`.

## Voices

Friday uses [Piper](https://github.com/rhasspy/piper) for text-to-speech. The default voice is `en_GB-jenny_dioco-medium` (British female).

**Install the default voice:**

```bash
mkdir -p ~/.local/share/piper-voices
cd ~/.local/share/piper-voices
curl -sL -o en_GB-jenny_dioco-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx"
curl -sL -o en_GB-jenny_dioco-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json"
```

**Use a different voice:**

Browse voices at [rhasspy/piper/voices](https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0). Download the `.onnx` and `.onnx.json` files to `~/.local/share/piper-voices/`, then set `voice.model` in `settings.json` to the model name (without `.onnx`).

## Settings

Edit `settings.json` in this directory:

```json
{
  "name": "Friday",
  "voice": {
    "enabled": false,
    "model": "en_GB-jenny_dioco-medium",
    "speed": 0.9
  },
  "wakeWord": {
    "enabled": false,
    "model": "hey_friday",
    "threshold": 0.3,
    "whisperModel": "tiny.en"
  },
  "typewriter": {
    "enabled": true
  },
  "panelWidth": 30
}
```

| Setting | Description |
|---------|-------------|
| `name` | Display name in status bar |
| `voice.model` | Piper voice model name (filename in `~/.local/share/piper-voices/` without `.onnx`) |
| `voice.speed` | Speech speed multiplier (0.9 = slightly slower) |
| `wakeWord.model` | openwakeword model name or custom `.onnx` filename without extension |
| `wakeWord.threshold` | Detection confidence (0.0-1.0, lower = more sensitive) |
| `wakeWord.whisperModel` | faster-whisper model size: `tiny.en`, `base.en`, `small.en`, `medium.en` |
| `typewriter.enabled` | Typewriter text effect in panel |
| `panelWidth` | Panel width as percentage of terminal |

## License

MIT
