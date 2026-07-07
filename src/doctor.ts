import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { detectCookieBrowsers } from "./cookies.js";
import { commandExists, ensureMacosSwiftc, ensureYtDlp, getFfmpegPath } from "./deps.js";
import { defaultAsrProvider, executableName, isSupportedPlatform, platformName } from "./platform.js";
import { runCommand } from "./process.js";
import type { CliOptions, RuntimePaths } from "./types.js";

const require = createRequire(import.meta.url);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(command: string): Promise<string | undefined> {
  try {
    return (await runCommand(command, ["--version"], { quiet: true })).stdout.trim().split(/\r?\n/)[0];
  } catch {
    return undefined;
  }
}

function packageInstalled(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function redactUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value;
  }
}

function effectiveOptions(options: CliOptions, paths: RuntimePaths): Record<string, unknown> {
  return {
    configPath: options.configPath,
    asr: options.asr,
    systemMode: options.systemMode,
    fallback: options.fallback,
    language: options.language,
    model: options.model,
    diarize: options.diarize,
    format: options.format,
    outputDir: options.outputDir,
    cacheDir: paths.cacheDir,
    offline: options.offline,
    keepAudio: options.keepAudio,
    keepOriginalAudio: options.keepOriginalAudio,
    chunkSeconds: options.chunkSeconds,
    filenameTemplate: options.filenameTemplate,
    audioQuality: options.audioQuality,
    browserCookies: options.browserCookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
    cookies: options.cookies,
    concurrentFragments: options.concurrentFragments,
    retries: options.retries,
    fragmentRetries: options.fragmentRetries,
    socketTimeout: options.socketTimeout,
    downloadTimeoutSeconds: options.downloadTimeoutSeconds,
    convertTimeoutSeconds: options.convertTimeoutSeconds,
    asrChunkTimeoutSeconds: options.asrChunkTimeoutSeconds,
    proxy: redactUrl(options.proxy),
    rateLimit: options.rateLimit,
    userAgent: options.userAgent,
    logFile: options.logFile,
    updateYtDlp: options.updateYtDlp,
  };
}

export async function runDoctor(paths: RuntimePaths, options: CliOptions, fix = false, showConfig = false): Promise<void> {
  console.log(`Platform: ${platformName()} (${process.platform}/${process.arch})`);
  console.log(`Supported: ${isSupportedPlatform() ? "yes" : "no; macOS, Linux, and Windows only"}`);
  console.log(`Node: ${process.version}`);
  console.log(`Config: ${options.configPath}`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`Default ASR: ${isSupportedPlatform() ? defaultAsrProvider() : "unsupported"}`);
  console.log(`Cache: ${paths.cacheDir}`);

  const cachedYtDlp = join(paths.toolsDir, executableName("yt-dlp"));
  const ytdlpCached = await exists(cachedYtDlp);
  const ytdlpOnPath = await commandExists("yt-dlp");
  const ytdlpPath = ytdlpCached ? cachedYtDlp : ytdlpOnPath ? "yt-dlp" : undefined;
  console.log(`yt-dlp: ${ytdlpPath ?? "missing"}`);
  if (ytdlpPath) {
    const version = await commandVersion(ytdlpPath);
    if (version) console.log(`yt-dlp version: ${version}`);
  }
  if (fix && !ytdlpPath) {
    console.log("yt-dlp: downloading");
    await ensureYtDlp(paths, options);
  }

  try {
    console.log(`ffmpeg: ${await getFfmpegPath()}`);
  } catch {
    console.log("ffmpeg: missing");
  }

  console.log(`tar: ${(await commandExists("tar")) ? "PATH" : "missing; needed for local ASR model archives"}`);
  console.log(`sherpa-onnx-node: ${packageInstalled("sherpa-onnx-node") ? "installed" : "missing optional dependency"}`);

  const browsers = await detectCookieBrowsers();
  console.log(`browser cookies: ${browsers.length ? browsers.map((browser) => `${browser.name} (${browser.id})`).join(", ") : "none detected"}`);

  if (process.platform === "darwin") {
    console.log("system ASR: macOS Speech.framework helper");
    const hasSwiftc = await commandExists("swiftc");
    console.log(`swiftc: ${hasSwiftc ? "PATH" : "missing; Xcode Command Line Tools required"}`);
    if (fix && !hasSwiftc) {
      await ensureMacosSwiftc(options);
    }
  } else if (process.platform === "win32") {
    console.log("system ASR: Windows SAPI helper (offline; untested)");
    console.log(`powershell.exe: ${(await commandExists("powershell.exe")) ? "PATH" : "missing"}`);
  } else if (process.platform === "linux") {
    console.log("system ASR: unavailable; local ASR is the default");
  } else {
    console.log("system ASR: unsupported platform");
  }

  const localModel = join(paths.modelsDir, `sherpa-onnx-whisper-${options.model}`);
  console.log(`local ASR model (${options.model}): ${(await exists(localModel)) ? "cached" : "not cached"}`);
  console.log(`diarization: ${(await exists(join(paths.modelsDir, "sherpa-onnx-pyannote-segmentation-3-0"))) ? "cached" : "not cached"}`);

  if (showConfig) {
    console.log("Effective options:");
    console.log(JSON.stringify(effectiveOptions(options, paths), null, 2));
  }
}
