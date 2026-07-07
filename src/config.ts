import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Yt2TextError } from "./errors.js";
import { defaultAsrProvider, defaultSystemMode } from "./platform.js";
import type { AsrProviderName, AudioQuality, FallbackMode, OutputFormat, SystemMode, WhisperModel } from "./types.js";

export interface ConfigFile {
  asr?: AsrProviderName;
  systemMode?: SystemMode;
  fallback?: FallbackMode;
  language?: string;
  model?: WhisperModel;
  diarize?: boolean;
  format?: OutputFormat;
  outputDir?: string;
  cacheDir?: string;
  offline?: boolean;
  keepAudio?: boolean;
  keepOriginalAudio?: boolean;
  chunkSeconds?: number;
  filenameTemplate?: string;
  audioQuality?: AudioQuality;
  verbose?: boolean;
  cookies?: string;
  cookiesFromBrowser?: string;
  browserCookies?: boolean;
  parallelDownloads?: number;
  concurrentFragments?: number;
  retries?: number;
  fragmentRetries?: number;
  socketTimeout?: number;
  downloadTimeoutSeconds?: number;
  convertTimeoutSeconds?: number;
  asrChunkTimeoutSeconds?: number;
  proxy?: string;
  rateLimit?: string;
  userAgent?: string;
  logFile?: string;
  updateYtDlp?: boolean;
}

const knownConfigKeys = new Set<keyof ConfigFile>([
  "asr",
  "systemMode",
  "fallback",
  "language",
  "model",
  "diarize",
  "format",
  "outputDir",
  "cacheDir",
  "offline",
  "keepAudio",
  "keepOriginalAudio",
  "chunkSeconds",
  "filenameTemplate",
  "audioQuality",
  "verbose",
  "cookies",
  "cookiesFromBrowser",
  "browserCookies",
  "parallelDownloads",
  "concurrentFragments",
  "retries",
  "fragmentRetries",
  "socketTimeout",
  "downloadTimeoutSeconds",
  "convertTimeoutSeconds",
  "asrChunkTimeoutSeconds",
  "proxy",
  "rateLimit",
  "userAgent",
  "logFile",
  "updateYtDlp",
]);

function optional(value: unknown): boolean {
  return value === undefined || value === null;
}

function configError(path: string, key: string, expected: string): Yt2TextError {
  return new Yt2TextError(`Invalid config ${path}: ${key} must be ${expected}`, "INVALID_CONFIG");
}

function enumValue<T extends string>(path: string, key: string, value: unknown, choices: readonly T[]): T | undefined {
  if (optional(value)) return undefined;
  if (typeof value === "string" && (choices as readonly string[]).includes(value)) return value as T;
  throw configError(path, key, `one of ${choices.join(", ")}`);
}

function stringValue(path: string, key: string, value: unknown): string | undefined {
  if (optional(value)) return undefined;
  if (typeof value === "string") return value;
  throw configError(path, key, "a string");
}

function booleanValue(path: string, key: string, value: unknown): boolean | undefined {
  if (optional(value)) return undefined;
  if (typeof value === "boolean") return value;
  throw configError(path, key, "a boolean");
}

function numberValue(path: string, key: string, value: unknown, min: number): number | undefined {
  if (optional(value)) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= min) return value;
  throw configError(path, key, `a number >= ${min}`);
}

function integerValue(path: string, key: string, value: unknown, min: number): number | undefined {
  if (optional(value)) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= min) return value;
  throw configError(path, key, `an integer >= ${min}`);
}

function normalizeConfig(raw: Record<string, unknown>, path: string): ConfigFile {
  for (const key of Object.keys(raw)) {
    if (!knownConfigKeys.has(key as keyof ConfigFile)) {
      throw new Yt2TextError(`Invalid config ${path}: unknown field "${key}"`, "INVALID_CONFIG");
    }
  }

  return {
    asr: enumValue(path, "asr", raw.asr, ["system", "local"] as const),
    systemMode: enumValue(path, "systemMode", raw.systemMode, ["online", "offline", "auto"] as const),
    fallback: enumValue(path, "fallback", raw.fallback, ["local", "fail"] as const),
    language: stringValue(path, "language", raw.language),
    model: enumValue(path, "model", raw.model, ["tiny", "base", "small", "medium"] as const),
    diarize: booleanValue(path, "diarize", raw.diarize),
    format: enumValue(path, "format", raw.format, ["txt", "json", "srt"] as const),
    outputDir: stringValue(path, "outputDir", raw.outputDir),
    cacheDir: stringValue(path, "cacheDir", raw.cacheDir),
    offline: booleanValue(path, "offline", raw.offline),
    keepAudio: booleanValue(path, "keepAudio", raw.keepAudio),
    keepOriginalAudio: booleanValue(path, "keepOriginalAudio", raw.keepOriginalAudio),
    chunkSeconds: numberValue(path, "chunkSeconds", raw.chunkSeconds, 10),
    filenameTemplate: stringValue(path, "filenameTemplate", raw.filenameTemplate),
    audioQuality: enumValue(path, "audioQuality", raw.audioQuality, ["best", "balanced", "small"] as const),
    verbose: booleanValue(path, "verbose", raw.verbose),
    cookies: stringValue(path, "cookies", raw.cookies),
    cookiesFromBrowser: stringValue(path, "cookiesFromBrowser", raw.cookiesFromBrowser),
    browserCookies: booleanValue(path, "browserCookies", raw.browserCookies),
    parallelDownloads: integerValue(path, "parallelDownloads", raw.parallelDownloads, 1),
    concurrentFragments: integerValue(path, "concurrentFragments", raw.concurrentFragments, 1),
    retries: integerValue(path, "retries", raw.retries, 0),
    fragmentRetries: integerValue(path, "fragmentRetries", raw.fragmentRetries, 0),
    socketTimeout: numberValue(path, "socketTimeout", raw.socketTimeout, 1),
    downloadTimeoutSeconds: numberValue(path, "downloadTimeoutSeconds", raw.downloadTimeoutSeconds, 0),
    convertTimeoutSeconds: numberValue(path, "convertTimeoutSeconds", raw.convertTimeoutSeconds, 0),
    asrChunkTimeoutSeconds: numberValue(path, "asrChunkTimeoutSeconds", raw.asrChunkTimeoutSeconds, 0),
    proxy: stringValue(path, "proxy", raw.proxy),
    rateLimit: stringValue(path, "rateLimit", raw.rateLimit),
    userAgent: stringValue(path, "userAgent", raw.userAgent),
    logFile: stringValue(path, "logFile", raw.logFile),
    updateYtDlp: booleanValue(path, "updateYtDlp", raw.updateYtDlp),
  };
}

export function defaultConfigPath(): string {
  if (process.env.YT2TEXT_CONFIG) return process.env.YT2TEXT_CONFIG;
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "yt2text", "config.json");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "yt2text", "config.json");
}

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export async function loadConfig(path = defaultConfigPath()): Promise<ConfigFile> {
  const target = expandHome(path);
  try {
    const body = await readFile(target, "utf8");
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Yt2TextError(`Invalid config ${target}: root must be a JSON object`, "INVALID_CONFIG");
    }
    return normalizeConfig(parsed as Record<string, unknown>, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      throw new Yt2TextError(`Invalid config ${target}: ${error.message}`, "INVALID_CONFIG");
    }
    throw error;
  }
}

export function defaultConfig(): ConfigFile {
  return {
    asr: defaultAsrProvider(),
    systemMode: defaultSystemMode(),
    fallback: "fail",
    language: "zh-CN",
    outputDir: "~/Downloads",
    format: "txt",
    cookiesFromBrowser: process.platform === "darwin" ? "auto" : undefined,
    browserCookies: true,
    model: "small",
    offline: false,
    diarize: false,
    chunkSeconds: 55,
    filenameTemplate: "{title}",
    audioQuality: "best",
    keepAudio: false,
    keepOriginalAudio: false,
    parallelDownloads: 4,
    concurrentFragments: 4,
    retries: 10,
    fragmentRetries: 10,
    socketTimeout: 20,
    downloadTimeoutSeconds: 1800,
    convertTimeoutSeconds: 600,
    asrChunkTimeoutSeconds: 180,
  };
}

export async function writeDefaultConfig(path = defaultConfigPath()): Promise<string> {
  const target = expandHome(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(defaultConfig(), null, 2)}\n`, "utf8");
  return target;
}
