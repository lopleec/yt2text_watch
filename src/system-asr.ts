import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { runCommand } from "./process.js";
import { ensureMacosSwiftc } from "./deps.js";
import { splitWav } from "./media.js";
import { mergeWordSegments } from "./segments.js";
import { ProgressBar } from "./progress.js";
import type { CliOptions, RuntimePaths, TranscriptSegment } from "./types.js";
import { Yt2TextError } from "./errors.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(sourceDir, "..");
const macosHelperVersion = "2";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface HelperOutput {
  engine?: string;
  language?: string;
  segments?: TranscriptSegment[];
  error?: string;
}

function isNoSpeechError(message: string): boolean {
  return /No speech detected|kAFAssistantErrorDomain Code=1110|Speech recognition produced no result/i.test(message);
}

function timeoutMs(seconds: number): number | undefined {
  return seconds > 0 ? seconds * 1000 : undefined;
}

function offsetSegments(segments: TranscriptSegment[], offset: number): TranscriptSegment[] {
  return segments.map((segment) => ({
    ...segment,
    start: segment.start + offset,
    end: segment.end + offset,
  }));
}

async function transcribeChunks(
  wavPath: string,
  paths: RuntimePaths,
  options: CliOptions,
  runChunk: (chunkPath: string) => Promise<HelperOutput>,
): Promise<{ engine: string; segments: TranscriptSegment[] }> {
  const chunkDir = join(paths.workDir, "system-chunks");
  await mkdir(chunkDir, { recursive: true });
  const chunks = await splitWav(wavPath, chunkDir, options.chunkSeconds, options.convertTimeoutSeconds);
  const all: TranscriptSegment[] = [];
  let engine = "system";
  const progress = new ProgressBar("Transcribing audio");

  try {
    progress.update(0, `0/${chunks.length} chunks`);
    for (let index = 0; index < chunks.length; index += 1) {
      const result = await runChunk(chunks[index]);
      engine = result.engine ?? engine;
      all.push(...offsetSegments(result.segments ?? [], index * options.chunkSeconds));
      progress.update((index + 1) / chunks.length, `${index + 1}/${chunks.length} chunks`);
    }
    progress.finish();
  } catch (error) {
    progress.fail();
    throw error;
  }

  return { engine, segments: mergeWordSegments(all) };
}

export async function transcribeWithSystem(
  wavPath: string,
  paths: RuntimePaths,
  options: CliOptions,
): Promise<{ engine: string; segments: TranscriptSegment[] }> {
  if (process.platform === "darwin") {
    const helperApp = await ensureMacosSpeechHelper(paths, options);
    return transcribeChunks(wavPath, paths, options, async (chunkPath) => {
      const mode = options.systemMode;
      const outputPath = join(paths.workDir, `macos-speech-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
      await rm(outputPath, { force: true });
      try {
        await runCommand("open", ["-n", "-j", "-g", "-W", helperApp, "--args", chunkPath, options.language, mode, outputPath], {
          quiet: true,
          timeoutMs: timeoutMs(options.asrChunkTimeoutSeconds),
        });
      } catch (error) {
        if (!(await exists(outputPath))) throw error;
      }
      if (!(await exists(outputPath))) {
        throw new Yt2TextError("macOS Speech helper did not write an output file", "SYSTEM_ASR_FAILED");
      }
      const body = await readFile(outputPath, "utf8");
      const parsed = JSON.parse(body) as HelperOutput;
      if (parsed.error) {
        if (isNoSpeechError(parsed.error)) {
          return {
            engine: mode === "offline" ? "macos-speech-on-device" : "macos-speech-system",
            language: options.language,
            segments: [],
          };
        }
        throw new Yt2TextError(parsed.error, "SYSTEM_ASR_FAILED");
      }
      return {
        engine: parsed.engine ?? "macos-speech-system",
        language: parsed.language ?? options.language,
        segments: parsed.segments ?? [],
      };
    });
  }

  if (process.platform === "win32") {
    if (options.systemMode === "online") {
      throw new Yt2TextError(
        "Windows system online file transcription is not available; use --system-mode offline, --system-mode auto, or --asr local.",
        "UNSUPPORTED_PROVIDER",
      );
    }

    const helper = join(projectRoot, "helpers", "windows-transcribe.ps1");
    return transcribeChunks(wavPath, paths, options, async (chunkPath) => {
      const result = await runCommand(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
          "-AudioPath",
          chunkPath,
          "-Language",
          options.language,
        ],
        { quiet: true, timeoutMs: timeoutMs(options.asrChunkTimeoutSeconds) },
      );
      return JSON.parse(result.stdout) as HelperOutput;
    });
  }

  throw new Yt2TextError("No cross-distro system ASR exists on Linux; use --asr local.", "UNSUPPORTED_PROVIDER");
}

async function ensureMacosSpeechHelper(paths: RuntimePaths, options: CliOptions): Promise<string> {
  const app = join(paths.toolsDir, "macos-transcribe.app");
  const binary = join(app, "Contents", "MacOS", "macos-transcribe");
  const infoPlist = join(app, "Contents", "Info.plist");
  const versionFile = join(app, "Contents", "Resources", "yt2text-helper-version");
  if ((await exists(binary)) && (await exists(infoPlist)) && (await exists(versionFile))) {
    const version = (await readFile(versionFile, "utf8")).trim();
    if (version === macosHelperVersion) return app;
  }

  const source = join(projectRoot, "helpers", "macos-transcribe.swift");
  const plist = join(projectRoot, "helpers", "macos-speech-info.plist");
  await ensureMacosSwiftc(options);
  await rm(app, { recursive: true, force: true });
  await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(join(app, "Contents", "Resources"), { recursive: true });
  await runCommand(
    "swiftc",
    [
      source,
      "-o",
      binary,
      "-Xlinker",
      "-sectcreate",
      "-Xlinker",
      "__TEXT",
      "-Xlinker",
      "__info_plist",
      "-Xlinker",
      plist,
    ],
    { quiet: true },
  );

  const { copyFile } = await import("node:fs/promises");
  await copyFile(plist, infoPlist);
  await writeFile(versionFile, `${macosHelperVersion}\n`);
  return app;
}
