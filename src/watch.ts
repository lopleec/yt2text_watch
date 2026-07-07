import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createRuntimePaths } from "./cache.js";
import { defaultConfig, expandHome, type ConfigFile } from "./config.js";
import { detectCookieBrowsers } from "./cookies.js";
import { ensureYtDlp } from "./deps.js";
import { asError, Yt2TextError } from "./errors.js";
import { installLogger } from "./logger.js";
import { defaultAsrProvider, defaultSystemMode } from "./platform.js";
import { runPipeline } from "./pipeline.js";
import { runCommand } from "./process.js";
import type { CliOptions } from "./types.js";

interface WatchChannel {
  id?: string;
  name?: string;
  url: string;
  enabled?: boolean;
}

interface WatchSchedule {
  time?: string;
  times?: string[];
  runOnStart?: boolean;
}

interface WatchCheck {
  maxScanVideosPerChannel?: number;
  maxNewVideosPerRun?: number;
  markExistingAsSeenOnFirstRun?: boolean;
  newestFirst?: boolean;
}

interface WatchPaths {
  outputDir?: string;
  logDir?: string;
  stateFile?: string;
}

interface WatchConfig {
  version?: number;
  schedule?: WatchSchedule;
  channels?: WatchChannel[];
  check?: WatchCheck;
  paths?: WatchPaths;
  transcription?: ConfigFile & { multilingual?: boolean };
}

interface WatchVideo {
  id: string;
  title: string;
  url: string;
  publishedAt?: string;
}

interface VideoRecord {
  status: "skipped" | "processed" | "failed";
  title: string;
  url: string;
  firstSeenAt: string;
  processedAt?: string;
  outputPath?: string;
  attempts?: number;
  lastError?: string;
}

interface ChannelState {
  name?: string;
  url: string;
  lastCheckedAt?: string;
  videos: Record<string, VideoRecord>;
}

interface WatchState {
  version: 1;
  channels: Record<string, ChannelState>;
}

export interface WatchRunOptions {
  init?: boolean;
  runOnce?: boolean;
  markSeen?: boolean;
  runOnStart?: boolean;
}

const defaultWatchFileName = "yt2text-watch.json";

export function defaultWatchConfigPath(): string {
  return join(process.cwd(), defaultWatchFileName);
}

export function defaultWatchConfig(): WatchConfig {
  const base = defaultConfig();
  return {
    version: 1,
    schedule: {
      times: ["03:00"],
      runOnStart: false,
    },
    channels: [
      {
        name: "Example channel",
        url: "https://www.youtube.com/@example/videos",
        enabled: false,
      },
    ],
    check: {
      maxScanVideosPerChannel: 30,
      maxNewVideosPerRun: 0,
      markExistingAsSeenOnFirstRun: true,
      newestFirst: false,
    },
    paths: {
      outputDir: "./transcripts",
      logDir: "./logs",
      stateFile: "./yt2text-watch-state.json",
    },
    transcription: {
      asr: defaultAsrProvider(),
      systemMode: defaultSystemMode(),
      fallback: "fail",
      language: base.language,
      format: base.format,
      model: base.model,
      diarize: false,
      filenameTemplate: "{date}-{title}",
      audioQuality: "balanced",
      keepAudio: false,
      keepOriginalAudio: false,
      browserCookies: true,
      cookiesFromBrowser: process.platform === "darwin" ? "auto" : undefined,
      parallelDownloads: 4,
      concurrentFragments: 4,
      retries: 10,
      fragmentRetries: 10,
      socketTimeout: 20,
      downloadTimeoutSeconds: 1800,
      convertTimeoutSeconds: 600,
      asrChunkTimeoutSeconds: 180,
      chunkSeconds: 55,
    },
  };
}

export async function writeDefaultWatchConfig(path = defaultWatchConfigPath()): Promise<string> {
  const target = resolvePath(process.cwd(), path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(defaultWatchConfig(), null, 2)}\n`, "utf8");
  return target;
}

async function loadWatchConfig(path: string): Promise<WatchConfig> {
  const target = resolvePath(process.cwd(), path);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Yt2TextError(`Invalid watch config ${target}: root must be a JSON object`, "INVALID_CONFIG");
    }
    return parsed as WatchConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Yt2TextError(
        `Watch config not found: ${target}\n\nCreate one with: yt2text watch --init ${target}`,
        "WATCH_CONFIG_NOT_FOUND",
      );
    }
    if (error instanceof SyntaxError) {
      throw new Yt2TextError(`Invalid watch config ${target}: ${error.message}`, "INVALID_CONFIG");
    }
    throw error;
  }
}

function resolvePath(baseDir: string, value: string): string {
  const expanded = expandHome(value);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function configDir(configPath: string): string {
  return dirname(resolvePath(process.cwd(), configPath));
}

function scheduleTimes(config: WatchConfig): string[] {
  const raw = config.schedule?.times ?? (config.schedule?.time ? [config.schedule.time] : ["03:00"]);
  const times = raw.map((time) => time.trim()).filter(Boolean);
  if (times.length === 0) throw new Yt2TextError("Watch schedule must include at least one time", "INVALID_CONFIG");
  for (const time of times) {
    parseTime(time);
  }
  return [...new Set(times)].sort();
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Yt2TextError(`Invalid watch schedule time "${value}". Use HH:mm, e.g. 03:00.`, "INVALID_CONFIG");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function nextRunAt(times: string[], now = new Date()): Date {
  const candidates = times.map((time) => {
    const { hour, minute } = parseTime(time);
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  });
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function channelKey(channel: WatchChannel): string {
  return (channel.id ?? channel.name ?? channel.url).trim();
}

function enabledChannels(config: WatchConfig): WatchChannel[] {
  const channels = config.channels ?? [];
  const enabled = channels.filter((channel) => channel.enabled !== false);
  if (enabled.length === 0) {
    throw new Yt2TextError("Watch config has no enabled channels. Set enabled=true or remove enabled=false.", "INVALID_CONFIG");
  }
  for (const channel of enabled) {
    if (!channel.url || typeof channel.url !== "string") {
      throw new Yt2TextError("Each enabled watch channel must include a url", "INVALID_CONFIG");
    }
  }
  return enabled;
}

function normalizeChannelUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isYoutube = parsed.hostname.endsWith("youtube.com") || parsed.hostname.endsWith("youtube-nocookie.com");
    if (!isYoutube) return url;
    if (parsed.pathname.includes("/videos") || parsed.pathname.includes("/shorts") || parsed.pathname.includes("/streams")) return url;
    if (parsed.pathname === "/watch" || parsed.pathname.startsWith("/playlist")) return url;
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/videos`;
    return parsed.toString();
  } catch {
    return url;
  }
}

function videoUrl(entry: Record<string, unknown>): string | undefined {
  const webpageUrl = typeof entry.webpage_url === "string" ? entry.webpage_url : undefined;
  if (webpageUrl?.startsWith("http")) return webpageUrl;

  const rawUrl = typeof entry.url === "string" ? entry.url : undefined;
  if (rawUrl?.startsWith("http")) return rawUrl;

  const id = typeof entry.id === "string" ? entry.id : rawUrl;
  return id ? `https://www.youtube.com/watch?v=${id}` : undefined;
}

function uploadDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return undefined;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

async function loadState(path: string): Promise<WatchState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("state must be an object");
    const maybe = parsed as WatchState;
    return {
      version: 1,
      channels: maybe.channels && typeof maybe.channels === "object" ? maybe.channels : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, channels: {} };
    throw new Yt2TextError(`Could not read watch state ${path}: ${asError(error).message}`, "WATCH_STATE_FAILED");
  }
}

async function saveState(path: string, state: WatchState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function transcriptionOptions(configPath: string, config: WatchConfig, logFile: string): CliOptions {
  const baseDir = configDir(configPath);
  const base = defaultConfig();
  const paths = config.paths ?? {};
  const t = config.transcription ?? {};
  const language = t.language ?? base.language ?? "zh-CN";
  const multilingual = Boolean(t.multilingual) || language.toLowerCase() === "auto";
  const outputDir = resolvePath(baseDir, paths.outputDir ?? t.outputDir ?? "./transcripts");
  const cacheDir = t.cacheDir ? resolvePath(baseDir, t.cacheDir) : undefined;
  const cookies = t.cookies ? resolvePath(baseDir, t.cookies) : undefined;
  const browserCookies = t.browserCookies ?? true;

  return {
    configPath: resolvePath(process.cwd(), configPath),
    asr: multilingual ? "local" : t.asr ?? defaultAsrProvider(),
    systemMode: t.systemMode ?? defaultSystemMode(),
    fallback: t.fallback ?? "fail",
    language: multilingual ? "auto" : language,
    model: t.model ?? "small",
    diarize: t.diarize ?? false,
    format: t.format ?? "txt",
    outputDir,
    cacheDir,
    offline: t.offline ?? false,
    keepAudio: t.keepAudio ?? false,
    keepOriginalAudio: t.keepOriginalAudio ?? false,
    chunkSeconds: t.chunkSeconds ?? 55,
    filenameTemplate: t.filenameTemplate ?? "{date}-{title}",
    audioQuality: t.audioQuality ?? "balanced",
    verbose: t.verbose ?? false,
    cookies,
    cookiesFromBrowser: cookies ? undefined : t.cookiesFromBrowser ?? (browserCookies === false ? undefined : process.platform === "darwin" ? "auto" : undefined),
    browserCookies,
    concurrentFragments: t.concurrentFragments ?? t.parallelDownloads ?? 4,
    retries: t.retries ?? 10,
    fragmentRetries: t.fragmentRetries ?? 10,
    socketTimeout: t.socketTimeout ?? 20,
    downloadTimeoutSeconds: t.downloadTimeoutSeconds ?? 1800,
    convertTimeoutSeconds: t.convertTimeoutSeconds ?? 600,
    asrChunkTimeoutSeconds: t.asrChunkTimeoutSeconds ?? 180,
    proxy: t.proxy,
    rateLimit: t.rateLimit,
    userAgent: t.userAgent,
    logFile: t.logFile ? resolvePath(baseDir, t.logFile) : logFile,
    updateYtDlp: t.updateYtDlp ?? false,
  };
}

async function listChannelVideos(channel: WatchChannel, options: CliOptions, limit: number): Promise<WatchVideo[]> {
  const paths = await createRuntimePaths(options);
  try {
    const ytdlp = await ensureYtDlp(paths, options);
    const baseArgs = [
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-end",
      String(limit),
      "--no-warnings",
      "--quiet",
      "--retries",
      String(options.retries),
      "--socket-timeout",
      String(options.socketTimeout),
    ];
    if (options.proxy) baseArgs.push("--proxy", options.proxy);
    if (options.userAgent) baseArgs.push("--user-agent", options.userAgent);
    if (options.cookies) baseArgs.push("--cookies", options.cookies);

    const browsers =
      options.cookies || !options.browserCookies
        ? []
        : options.cookiesFromBrowser === "auto"
          ? await detectCookieBrowsers()
          : options.cookiesFromBrowser
            ? [{ id: options.cookiesFromBrowser, name: options.cookiesFromBrowser }]
            : [];
    const attempts = browsers.length > 0 ? browsers : [undefined];
    let lastError: unknown;

    for (const browser of attempts) {
      const args = [...baseArgs];
      if (browser) args.push("--cookies-from-browser", browser.id);
      args.push(normalizeChannelUrl(channel.url));

      try {
        const result = await runCommand(ytdlp, args, {
          quiet: true,
          timeoutMs: options.downloadTimeoutSeconds > 0 ? options.downloadTimeoutSeconds * 1000 : undefined,
        });
        const parsed = JSON.parse(result.stdout) as { entries?: Array<Record<string, unknown>> };
        return (parsed.entries ?? []).flatMap((entry) => {
            const url = videoUrl(entry);
            const id = typeof entry.id === "string" ? entry.id : undefined;
            const title = typeof entry.title === "string" ? entry.title : id ?? "Untitled video";
            if (!id || !url) return [];
            const publishedAt = uploadDate(entry.upload_date);
            return publishedAt ? [{ id, title, url, publishedAt }] : [{ id, title, url }];
          });
      } catch (error) {
        lastError = error;
        if (options.cookiesFromBrowser !== "auto" || !browser) break;
        console.error(`Could not list ${channel.name ?? channel.url} with ${browser.name} cookies; trying another browser.`);
      }
    }

    throw new Yt2TextError(`Could not list videos for ${channel.name ?? channel.url}: ${asError(lastError).message}`, "WATCH_LIST_FAILED");
  } finally {
    await rm(paths.workDir, { recursive: true, force: true });
  }
}

async function runWatchOnce(configPath: string, config: WatchConfig, statePath: string, options: CliOptions, markSeenOnly: boolean): Promise<void> {
  const state = await loadState(statePath);
  const channels = enabledChannels(config);
  const check = config.check ?? {};
  const maxScan = check.maxScanVideosPerChannel ?? 30;
  const maxNew = check.maxNewVideosPerRun ?? 0;
  const markExisting = check.markExistingAsSeenOnFirstRun ?? true;

  console.error(`Checking ${channels.length} YouTube channel(s)...`);
  for (const channel of channels) {
    const key = channelKey(channel);
    const channelState = state.channels[key] ?? {
      name: channel.name,
      url: channel.url,
      videos: {},
    };
    channelState.name = channel.name ?? channelState.name;
    channelState.url = channel.url;
    state.channels[key] = channelState;

    console.error(`Listing ${channel.name ?? channel.url}`);
    const videos = await listChannelVideos(channel, options, maxScan);
    const firstRun = Object.keys(channelState.videos).length === 0;
    const now = new Date().toISOString();

    if ((firstRun && markExisting) || markSeenOnly) {
      for (const video of videos) {
        channelState.videos[video.id] ??= {
          status: "skipped",
          title: video.title,
          url: video.url,
          firstSeenAt: now,
        };
      }
      channelState.lastCheckedAt = now;
      await saveState(statePath, state);
      console.error(`Marked ${videos.length} existing video(s) as seen for ${channel.name ?? channel.url}.`);
      continue;
    }

    const candidates = videos.filter((video) => {
      const existing = channelState.videos[video.id];
      return !existing || existing.status === "failed";
    });
    const ordered = check.newestFirst ? candidates : [...candidates].reverse();
    const selected = maxNew > 0 ? ordered.slice(0, maxNew) : ordered;

    console.error(`Found ${selected.length} new video(s) for ${channel.name ?? channel.url}.`);
    for (const video of selected) {
      const previous = channelState.videos[video.id];
      channelState.videos[video.id] = {
        status: "failed",
        title: video.title,
        url: video.url,
        firstSeenAt: previous?.firstSeenAt ?? now,
        attempts: (previous?.attempts ?? 0) + 1,
      };
      await saveState(statePath, state);

      try {
        console.error(`Transcribing: ${video.title}`);
        const outputPath = await runPipeline(video.url, "url", options);
        channelState.videos[video.id] = {
          ...channelState.videos[video.id],
          status: "processed",
          processedAt: new Date().toISOString(),
          outputPath,
          lastError: undefined,
        };
      } catch (error) {
        channelState.videos[video.id] = {
          ...channelState.videos[video.id],
          status: "failed",
          lastError: asError(error).message,
        };
        console.error(`Failed: ${video.title}`);
        console.error(asError(error).message);
      } finally {
        channelState.lastCheckedAt = new Date().toISOString();
        await saveState(statePath, state);
      }
    }

    channelState.lastCheckedAt = new Date().toISOString();
    await saveState(statePath, state);
  }
}

async function runScheduledCheck(configPath: string, config: WatchConfig, statePath: string, options: CliOptions): Promise<void> {
  try {
    await runWatchOnce(configPath, config, statePath, options, false);
  } catch (error) {
    console.error(`Watch run failed: ${asError(error).message}`);
  }
}

export async function runWatch(configPath: string, runOptions: WatchRunOptions = {}): Promise<void> {
  if (runOptions.init) {
    const target = await writeDefaultWatchConfig(configPath);
    console.log(target);
    return;
  }

  const absoluteConfig = resolvePath(process.cwd(), configPath);
  const baseDir = dirname(absoluteConfig);
  const config = await loadWatchConfig(absoluteConfig);
  const paths = config.paths ?? {};
  const logDir = resolvePath(baseDir, paths.logDir ?? "./logs");
  const statePath = resolvePath(baseDir, paths.stateFile ?? "./yt2text-watch-state.json");
  await mkdir(logDir, { recursive: true });
  const logFile = join(logDir, "yt2text-watch.log");
  const options = transcriptionOptions(absoluteConfig, config, logFile);
  await installLogger(options.logFile);

  console.error(`Watch config: ${absoluteConfig}`);
  console.error(`Watch state: ${statePath}`);
  console.error(`Watch logs: ${logFile}`);

  if (runOptions.runOnce) {
    await runWatchOnce(absoluteConfig, config, statePath, options, Boolean(runOptions.markSeen));
    return;
  }

  const times = scheduleTimes(config);
  const shouldRunOnStart = runOptions.runOnStart ?? config.schedule?.runOnStart ?? false;
  if (shouldRunOnStart) {
    await runScheduledCheck(absoluteConfig, config, statePath, options);
  }

  while (true) {
    const next = nextRunAt(times);
    console.error(`Next watch run: ${next.toLocaleString()}`);
    await sleep(Math.max(1000, next.getTime() - Date.now()));
    await runScheduledCheck(absoluteConfig, config, statePath, options);
  }
}
