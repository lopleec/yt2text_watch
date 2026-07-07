# yt2text Watch

This is a scheduled watcher fork of [lopleec/yt2text](https://github.com/lopleec/yt2text). It keeps the original URL/file transcription CLI and adds `yt2text watch` for checking YouTube channels on a schedule.

Download audio from YouTube or another `yt-dlp` supported URL, transcribe it locally or through the platform speech interface, and save the result as `txt`, `json`, or `srt`.

Windows support is included but currently untested. macOS and Linux are the primary targets.

## Features

- Downloads audio only through `yt-dlp`.
- Uses macOS Speech.framework by default on macOS.
- Uses local Whisper ASR by default on Linux.
- Includes a best-effort Windows SAPI helper, marked untested.
- Supports local multilingual ASR with `--multilingual` or `-l auto`.
- Optional anonymous speaker diarization with `--diarize`.
- Browser cookie auto-detection, manual cookies files, proxy, retries, timeouts, and fragment concurrency.
- Progress output for dependency downloads, media download, conversion, and transcription.
- JSON config file with CLI flags taking precedence.
- Output filename templates and optional audio retention.

## Requirements

- Node.js 20 or newer.
- Network access on first use to download `yt-dlp` and, when local ASR is enabled, ASR models.
- macOS system ASR requires Speech Recognition permission and Xcode Command Line Tools for `swiftc`; yt2text automatically opens Apple's `xcode-select --install` installer when `swiftc` is missing.
- Linux local ASR requires the optional `sherpa-onnx-node` package to install correctly.
- `ffmpeg` is bundled through `@ffmpeg-installer/ffmpeg`; a system `ffmpeg` is used as fallback.

## Install

Recommended for this fork:

```bash
npm install -g yt2text-watch
```

From this repository:

```bash
git clone https://github.com/lopleec/yt2text_watch.git
cd yt2text_watch
npm install
npm run build
npm link
```

Run a local checkout without linking:

```bash
npm run dev -- "https://www.youtube.com/watch?v=ROrOGwJDneo" -l en-US
```

## Quick Start

macOS default: browser cookies are auto-detected, the system Speech interface runs in offline/on-device mode, and the transcript is saved as `txt` in `~/Downloads`.

```bash
yt2text "https://www.youtube.com/watch?v=ROrOGwJDneo" -l en-US
```

Chinese video using the macOS default language:

```bash
yt2text "https://www.youtube.com/watch?v=muAgkhaoLDA"
```

Mixed-language or unknown-language video:

```bash
yt2text "https://youtu.be/..." --multilingual
```

Local file:

```bash
yt2text file ./audio.wav -l en-US
```

Interactive terminal mode:

```bash
yt2text
```

Check dependencies and effective configuration:

```bash
yt2text doctor --fix --show-config
```

`--fix` downloads missing small runtime tools such as `yt-dlp`. On macOS it also opens the Xcode Command Line Tools installer if `swiftc` is missing. That Apple installer still requires the user to finish the system dialog, then rerun yt2text.

## Platform Defaults

| Platform | Default ASR | Notes |
| --- | --- | --- |
| macOS | `system` | Uses Speech.framework with `--system-mode offline`; browser cookies default to `auto`. |
| Linux | `local` | No single cross-distro system speech API is assumed; first local ASR run downloads models. |
| Windows | `system` | Uses a best-effort offline SAPI helper. This path is included but not tested. |

Use `--asr local` to force local ASR, or `--fallback local` to try local ASR if system ASR fails.

## Common Commands

```bash
yt2text "https://youtu.be/..."                         # direct run
yt2text "https://youtu.be/..." -l en-US                # English locale
yt2text "https://youtu.be/..." --asr local             # force local Whisper ASR
yt2text "https://youtu.be/..." --multilingual          # local ASR with language auto-detect
yt2text "https://youtu.be/..." --diarize               # anonymous speaker labels
yt2text "https://youtu.be/..." -f srt                  # subtitle output
yt2text "https://youtu.be/..." --audio-quality small   # smaller download
yt2text "https://youtu.be/..." --parallel-downloads 8  # faster fragmented downloads
yt2text "https://youtu.be/..." --keep-original-audio --keep-audio
yt2text file ./meeting.m4a -l zh-CN
yt2text config
yt2text config --print
yt2text doctor
yt2text watch --init ./yt2text-watch.json
yt2text watch ./yt2text-watch.json --run-once
yt2text watch ./yt2text-watch.json
```

## Important Options

ASR:

- `--asr system|local`
- `--system-mode online|offline|auto`
- `--fallback local|fail`
- `-l, --language <locale>` such as `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, or `auto`
- `--multilingual`
- `--model tiny|base|small|medium`
- `--diarize`
- `--chunk-seconds <seconds>`

Output:

- `-f, --format txt|json|srt`
- `-o, --output <dir>`
- `--filename-template <template>`
- `--keep-original-audio`
- `--keep-audio`
- `--log-file <file>`

Filename template tokens:

- `{title}`
- `{date}`
- `{datetime}`
- `{language}`
- `{engine}`
- `{source}`

Download and cookies:

- `--cookies <file>`
- `--cookies-from-browser auto|chrome|safari|firefox|edge|brave|chromium`
- `--no-browser-cookies`
- `--audio-quality best|balanced|small`
- `--parallel-downloads <n>`
- `--concurrent-fragments <n>`
- `--retries <n>`
- `--fragment-retries <n>`
- `--socket-timeout <seconds>`
- `--download-timeout <seconds>`
- `--proxy <url>`
- `--rate-limit <rate>`
- `--user-agent <ua>`
- `--update-ytdlp`

Runtime:

- `--config <file>`
- `--cache-dir <dir>`
- `--offline`
- `--convert-timeout <seconds>`
- `--asr-chunk-timeout <seconds>`
- `-v, --verbose`

## Daily Channel Watcher

`yt2text watch` checks one or more YouTube channel pages, records which videos have already been seen, and transcribes new videos when they appear.

Create a watch config in the current folder:

```bash
yt2text watch --init ./yt2text-watch.json
```

Edit `yt2text-watch.json` and replace the example channel:

```json
{
  "schedule": {
    "times": ["03:00"],
    "runOnStart": false
  },
  "channels": [
    {
      "name": "Bloomberg TV",
      "url": "https://www.youtube.com/@markets/videos",
      "enabled": true
    }
  ],
  "check": {
    "maxScanVideosPerChannel": 30,
    "maxNewVideosPerRun": 0,
    "markExistingAsSeenOnFirstRun": true,
    "newestFirst": false
  },
  "paths": {
    "outputDir": "./transcripts",
    "logDir": "./logs",
    "stateFile": "./yt2text-watch-state.json"
  },
  "transcription": {
    "language": "zh-CN",
    "format": "txt",
    "cookiesFromBrowser": "auto",
    "audioQuality": "balanced",
    "filenameTemplate": "{date}-{title}"
  }
}
```

Useful commands:

```bash
yt2text watch ./yt2text-watch.json --run-once
yt2text watch ./yt2text-watch.json --mark-seen --run-once
yt2text watch ./yt2text-watch.json
```

Behavior:

- `--run-once` checks now and exits.
- Without `--run-once`, the process stays open and runs every day at the configured `schedule.times`.
- `--mark-seen --run-once` records the currently listed videos without transcribing them.
- By default, the first run marks existing videos as seen, so future runs only process new videos.
- Set `markExistingAsSeenOnFirstRun` to `false` if you want the first run to transcribe existing listed videos.
- `maxScanVideosPerChannel` controls how many latest videos are scanned per channel.
- `maxNewVideosPerRun: 0` means no limit.
- Relative `outputDir`, `logDir`, and `stateFile` paths are resolved relative to the watch JSON file.
- Logs default to `./logs/yt2text-watch.log` next to the JSON file.
- State defaults to `./yt2text-watch-state.json` next to the JSON file.

Simple background run on macOS/Linux:

```bash
mkdir -p ./logs
nohup yt2text watch ./yt2text-watch.json >> ./logs/watch.out 2>&1 &
```

For a machine that reboots often, run `yt2text watch ./yt2text-watch.json --run-once` from `cron`, `launchd`, or `systemd` instead.

## Configuration

Create a config file:

```bash
yt2text config
```

Default paths:

- macOS/Linux: `~/.config/yt2text/config.json`
- Windows: `%APPDATA%\yt2text\config.json`

Print the platform-specific default config without writing:

```bash
yt2text config --print
```

Example:

```json
{
  "asr": "system",
  "systemMode": "offline",
  "fallback": "fail",
  "language": "zh-CN",
  "outputDir": "~/Downloads",
  "format": "txt",
  "cookiesFromBrowser": "auto",
  "browserCookies": true,
  "model": "small",
  "offline": false,
  "diarize": false,
  "chunkSeconds": 55,
  "filenameTemplate": "{date}-{title}",
  "audioQuality": "balanced",
  "keepAudio": false,
  "keepOriginalAudio": false,
  "parallelDownloads": 8,
  "concurrentFragments": 8,
  "retries": 20,
  "fragmentRetries": 20,
  "socketTimeout": 30,
  "downloadTimeoutSeconds": 1800,
  "convertTimeoutSeconds": 600,
  "asrChunkTimeoutSeconds": 180,
  "logFile": "~/Downloads/yt2text.log"
}
```

CLI flags override config values. Environment variables:

- `YT2TEXT_CONFIG`
- `YT2TEXT_OUTPUT_DIR`
- `YT2TEXT_LANGUAGE`
- `YT2TEXT_CACHE_DIR`

## Cookies

For many YouTube videos, cookies are not needed. When YouTube asks for sign-in or bot verification, use browser cookies:

```bash
yt2text "https://youtu.be/..." --cookies-from-browser chrome
```

macOS defaults to `--cookies-from-browser auto`. You can disable this:

```bash
yt2text "https://youtu.be/..." --no-browser-cookies
```

Manual Netscape cookies file:

```bash
yt2text "https://youtu.be/..." --cookies ./cookies.txt
```

## Local ASR Models

Local ASR uses `sherpa-onnx-node` and Whisper-style models from the sherpa-onnx project. First use downloads model files into the cache directory. Larger models usually improve accuracy but cost more disk, memory, and CPU time.

```bash
yt2text "https://youtu.be/..." --asr local --model tiny
yt2text "https://youtu.be/..." --asr local --model small
yt2text "https://youtu.be/..." --multilingual --model medium
```

Use `--offline` only after dependencies and models are already cached.

## Speaker Labels

`--diarize` adds anonymous labels such as `Speaker 1` and `Speaker 2`. It does not identify real people by name. Diarization downloads extra local models on first use.

```bash
yt2text "https://youtu.be/..." --asr local --diarize
```

## Troubleshooting

Run:

```bash
yt2text doctor --fix --show-config
```

Common fixes:

- `npm` says `package.json` is missing: run commands from the project directory, or install/link the CLI globally first.
- YouTube requires sign-in: try `--cookies-from-browser chrome`, `safari`, or `firefox`.
- Browser cookie database is locked: fully quit the browser and retry.
- 403 or bot verification: use cookies, then try `--update-ytdlp`; if needed, configure `--proxy`.
- macOS Speech permission denied: allow Speech Recognition for the helper when macOS prompts.
- `swiftc` is missing: yt2text automatically opens the Xcode Command Line Tools installer on macOS. Finish the system installer and rerun the command; if it did not open, run `xcode-select --install`.
- Local ASR dependency missing: reinstall without `--no-optional`.
- Local model extraction fails: make sure `tar` with bzip2 support is available.
- Long files time out: increase `--download-timeout`, `--convert-timeout`, or `--asr-chunk-timeout`.

## Development

```bash
npm install
npm run check
npm run build
npm test
npm pack --dry-run
```

Useful local commands:

```bash
node dist/cli.js doctor --show-config
node dist/cli.js "https://www.youtube.com/watch?v=ROrOGwJDneo" -l en-US
node dist/cli.js file ./audio.wav -l en-US -o ./out
```

## Privacy

The CLI stores downloaded tools, ASR models, temporary audio, and optional logs on your machine. Temporary work files are removed after each run. If you pass browser cookies or a manual cookies file, `yt-dlp` reads them locally to access the requested media. Be careful when sharing logs, configs, transcripts, and retained audio files.

## Acknowledgements

- Original project: [lopleec/yt2text](https://github.com/lopleec/yt2text).
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) for media extraction and download support.
- [`FFmpeg`](https://ffmpeg.org/) and `@ffmpeg-installer/ffmpeg` for audio conversion.
- [`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) and `sherpa-onnx-node` for local ASR and diarization runtime support.
- OpenAI Whisper model architecture and the broader open speech recognition ecosystem.
- Apple Speech.framework and Windows SAPI for platform speech interfaces.

## Disclaimer

This project is not affiliated with YouTube, Google, Apple, Microsoft, FFmpeg, yt-dlp, sherpa-onnx, or OpenAI.

Use this tool only for media you are allowed to access, download, and transcribe. You are responsible for complying with copyright law, platform terms of service, privacy rules, consent requirements, and any laws that apply in your jurisdiction. The software is provided as-is under the MIT License, without warranty.

## License

MIT.
