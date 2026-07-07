#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command, InvalidArgumentError } from "commander";
import { createRuntimePaths } from "./cache.js";
import { defaultConfigPath, expandHome, loadConfig, writeDefaultConfig, type ConfigFile } from "./config.js";
import { defaultCookiesFromBrowser, detectCookieBrowsers, knownCookieBrowsers } from "./cookies.js";
import { runDoctor } from "./doctor.js";
import { installLogger } from "./logger.js";
import { defaultAsrProvider, defaultSystemMode } from "./platform.js";
import { runPipeline } from "./pipeline.js";
import { defaultWatchConfigPath, runWatch } from "./watch.js";
import { explainError } from "./errors.js";
import type { AudioQuality, CliOptions, OutputFormat, WhisperModel } from "./types.js";

const defaultLanguage = process.env.YT2TEXT_LANGUAGE ?? "zh-CN";

function defaultOutputDir(): string {
  return process.env.YT2TEXT_OUTPUT_DIR ?? expandHome("~/Downloads");
}

function parseChoice<T extends string>(value: string, choices: readonly T[]): T {
  if ((choices as readonly string[]).includes(value)) return value as T;
  throw new InvalidArgumentError(`Expected one of: ${choices.join(", ")}`);
}

function parseIntegerOption(name: string, min: number): (value: string) => number {
  return (value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) throw new InvalidArgumentError(`${name} must be an integer >= ${min}`);
    return parsed;
  };
}

function parseNumberOption(name: string, min: number): (value: string) => number {
  return (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) throw new InvalidArgumentError(`${name} must be a number >= ${min}`);
    return parsed;
  };
}

function commandValue<T>(
  command: Command,
  config: ConfigFile,
  optionName: string,
  configName = optionName,
): T | undefined {
  const opts = command.opts<Record<string, unknown>>();
  const source = command.getOptionValueSource(optionName);
  const configured = config[configName as keyof ConfigFile] as T | undefined;
  return source !== "cli" && configured !== undefined ? configured : opts[optionName] as T | undefined;
}

async function collectOptions(command: Command): Promise<CliOptions> {
  const raw = command.opts<Record<string, unknown>>();
  const configPath = expandHome(String(raw.config ?? defaultConfigPath()));
  const config = await loadConfig(configPath);
  const language = String(commandValue<string>(command, config, "language") ?? defaultLanguage);
  const multilingual = Boolean(raw.multilingual) || language.toLowerCase() === "auto";
  const cookies = commandValue<string>(command, config, "cookies");
  const requestedBrowser = commandValue<string>(command, config, "cookiesFromBrowser");
  const browserCookies = commandValue<boolean>(command, config, "browserCookies") ?? true;
  const parallelDownloads =
    command.getOptionValueSource("concurrentFragments") === "cli"
      ? commandValue<number>(command, config, "concurrentFragments")
      : command.getOptionValueSource("parallelDownloads") === "cli"
        ? commandValue<number>(command, config, "parallelDownloads")
        : config.concurrentFragments ?? config.parallelDownloads ?? commandValue<number>(command, config, "concurrentFragments");

  return {
    configPath,
    asr: multilingual ? "local" : commandValue(command, config, "asr"),
    systemMode: commandValue(command, config, "systemMode") as CliOptions["systemMode"],
    fallback: commandValue(command, config, "fallback") as CliOptions["fallback"],
    language: multilingual ? "auto" : language,
    model: commandValue(command, config, "model") as WhisperModel,
    diarize: Boolean(commandValue(command, config, "diarize")),
    format: commandValue(command, config, "format") as OutputFormat,
    outputDir: expandHome(String(commandValue(command, config, "output", "outputDir") ?? defaultOutputDir())),
    cacheDir: commandValue<string>(command, config, "cacheDir") ? expandHome(String(commandValue<string>(command, config, "cacheDir"))) : undefined,
    offline: Boolean(commandValue(command, config, "offline")),
    keepAudio: Boolean(commandValue(command, config, "keepAudio")),
    keepOriginalAudio: Boolean(commandValue(command, config, "keepOriginalAudio")),
    chunkSeconds: Number(commandValue(command, config, "chunkSeconds")),
    filenameTemplate: String(commandValue(command, config, "filenameTemplate") ?? "{title}"),
    audioQuality: commandValue(command, config, "audioQuality") as AudioQuality,
    verbose: Boolean(commandValue(command, config, "verbose")),
    cookies: cookies ? expandHome(cookies) : undefined,
    cookiesFromBrowser: cookies ? undefined : requestedBrowser ?? (browserCookies === false ? undefined : defaultCookiesFromBrowser()),
    browserCookies,
    concurrentFragments: Number(parallelDownloads),
    retries: Number(commandValue(command, config, "retries")),
    fragmentRetries: Number(commandValue(command, config, "fragmentRetries")),
    socketTimeout: Number(commandValue(command, config, "socketTimeout")),
    downloadTimeoutSeconds: Number(commandValue(command, config, "downloadTimeout", "downloadTimeoutSeconds")),
    convertTimeoutSeconds: Number(commandValue(command, config, "convertTimeout", "convertTimeoutSeconds")),
    asrChunkTimeoutSeconds: Number(commandValue(command, config, "asrChunkTimeout", "asrChunkTimeoutSeconds")),
    proxy: commandValue<string>(command, config, "proxy"),
    rateLimit: commandValue<string>(command, config, "rateLimit"),
    userAgent: commandValue<string>(command, config, "userAgent"),
    logFile: commandValue<string>(command, config, "logFile") ? expandHome(String(commandValue<string>(command, config, "logFile"))) : undefined,
    updateYtDlp: Boolean(commandValue(command, config, "updateYtDlp")),
  };
}

function addCommonOptions(command: Command): Command {
  return command
    .option("--config <file>", "JSON config file", defaultConfigPath())
    .option("--asr <provider>", "ASR provider: system or local", (value) => parseChoice(value, ["system", "local"] as const), defaultAsrProvider())
    .option("--system-mode <mode>", "System ASR mode: online, offline, or auto", (value) => parseChoice(value, ["online", "offline", "auto"] as const), defaultSystemMode())
    .option("--fallback <mode>", "Fallback when system ASR fails: local or fail", (value) => parseChoice(value, ["local", "fail"] as const), "fail")
    .option("-l, --language <locale>", "Recognition locale, or auto for local multilingual ASR", defaultLanguage)
    .option("--multilingual", "Use local ASR with automatic language detection", false)
    .option("--model <model>", "Local ASR model", (value) => parseChoice(value, ["tiny", "base", "small", "medium"] as const), "small")
    .option("--diarize", "Add anonymous speaker labels using local diarization", false)
    .option("-f, --format <format>", "Output format", (value) => parseChoice(value, ["txt", "json", "srt"] as const), "txt")
    .option("-o, --output <dir>", "Output directory", defaultOutputDir())
    .option("--cache-dir <dir>", "Override cache directory")
    .option("--offline", "Do not download missing tools or models", false)
    .option("--keep-audio", "Keep normalized WAV next to the transcript", false)
    .option("--keep-original-audio", "Keep the original downloaded audio next to the transcript", false)
    .option("--filename-template <template>", "Output filename template, e.g. {date}-{title}", "{title}")
    .option("--audio-quality <quality>", "Downloaded audio quality: best, balanced, or small", (value) => parseChoice(value, ["best", "balanced", "small"] as const), "best")
    .option("--cookies <file>", "Pass a Netscape cookies file to yt-dlp")
    .option("--cookies-from-browser <browser>", "Read cookies from a browser, e.g. auto, chrome, safari, firefox")
    .option("--no-browser-cookies", "Do not automatically read browser cookies")
    .option("--parallel-downloads <n>", "Alias for yt-dlp parallel fragment downloads", parseIntegerOption("parallel downloads", 1))
    .option("--concurrent-fragments <n>", "yt-dlp fragment concurrency", parseIntegerOption("concurrent fragments", 1), 4)
    .option("--retries <n>", "yt-dlp download retries", parseIntegerOption("retries", 0), 10)
    .option("--fragment-retries <n>", "yt-dlp fragment retries", parseIntegerOption("fragment retries", 0), 10)
    .option("--socket-timeout <seconds>", "yt-dlp socket timeout", parseNumberOption("socket timeout", 1), 20)
    .option("--download-timeout <seconds>", "Fail yt-dlp if download exceeds this time; 0 disables", parseNumberOption("download timeout", 0), 1800)
    .option("--convert-timeout <seconds>", "Fail ffmpeg conversion/splitting if it exceeds this time; 0 disables", parseNumberOption("convert timeout", 0), 600)
    .option("--asr-chunk-timeout <seconds>", "Fail each system ASR chunk if it exceeds this time; 0 disables", parseNumberOption("ASR chunk timeout", 0), 180)
    .option("--proxy <url>", "Proxy URL for yt-dlp")
    .option("--rate-limit <rate>", "yt-dlp rate limit, e.g. 2M or 500K")
    .option("--user-agent <ua>", "Custom yt-dlp user agent")
    .option("--log-file <file>", "Append logs to a file")
    .option("--update-ytdlp", "Force refresh cached yt-dlp before downloading", false)
    .option("--chunk-seconds <seconds>", "System ASR chunk size", (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 10) throw new InvalidArgumentError("Expected a number >= 10");
      return parsed;
    }, 55)
    .option("-v, --verbose", "Verbose logging", false);
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function askRequired(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  while (true) {
    const value = (await rl.question(question)).trim();
    if (value) return value;
  }
}

async function askDefault(rl: ReturnType<typeof createInterface>, question: string, defaultValue: string): Promise<string> {
  const value = (await rl.question(`${question} [${defaultValue}]: `)).trim();
  return value || defaultValue;
}

async function askChoice<T extends string>(
  rl: ReturnType<typeof createInterface>,
  question: string,
  choices: Array<{ label: string; value: T }>,
  defaultIndex = 0,
): Promise<T> {
  console.error(question);
  choices.forEach((choice, index) => {
    const marker = index === defaultIndex ? "*" : " ";
    console.error(`  ${index + 1}. ${marker} ${choice.label}`);
  });

  while (true) {
    const answer = (await rl.question(`Choose [${defaultIndex + 1}]: `)).trim();
    if (!answer) return choices[defaultIndex].value;
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && choices[index]) return choices[index].value;
  }
}

async function runInteractive(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const config = await loadConfig();
    console.error("yt2text interactive mode");
    const source = expandHome(await askRequired(rl, "YouTube URL or local file path: "));
    const inputKind = isUrl(source) ? "url" : "file";
    const languageChoice = await askChoice(rl, "Recognition language", [
      { label: "Chinese (zh-CN)", value: "zh-CN" },
      { label: "English (en-US)", value: "en-US" },
      { label: "Auto / multilingual (local ASR)", value: "auto" },
      { label: "Custom locale", value: "custom" },
    ]);
    const languageDefault = config.language ?? defaultLanguage;
    const language = languageChoice === "custom" ? await askDefault(rl, "Locale", languageDefault) : languageChoice;
    const multilingual = language === "auto";
    const outputDir = expandHome(await askDefault(rl, "Output directory", config.outputDir ?? defaultOutputDir()));

    let cookies: string | undefined;
    let cookiesFromBrowser: string | undefined;
    let browserCookies = true;

    if (inputKind === "url") {
      const cookieMode = await askChoice(rl, "YouTube cookies", [
        { label: "Auto-detect browser cookies", value: "auto" },
        { label: "Choose a browser", value: "browser" },
        { label: "Manual cookies file", value: "file" },
        { label: "No cookies", value: "none" },
      ]);

      if (cookieMode === "auto") {
        cookiesFromBrowser = "auto";
      } else if (cookieMode === "browser") {
        const detected = await detectCookieBrowsers();
        const detectedIds = new Set(detected.map((browser) => browser.id));
        const browsers = knownCookieBrowsers().map((browser) => ({
          label: detectedIds.has(browser.id) ? `${browser.name} (${browser.id}, detected)` : `${browser.name} (${browser.id})`,
          value: browser.id,
        }));
        cookiesFromBrowser = await askChoice(rl, "Browser", browsers);
      } else if (cookieMode === "file") {
        cookies = expandHome(await askRequired(rl, "Cookies file path: "));
      } else {
        browserCookies = false;
      }
    }

    const options: CliOptions = {
      configPath: defaultConfigPath(),
      asr: multilingual ? "local" : config.asr ?? defaultAsrProvider(),
      systemMode: config.systemMode ?? defaultSystemMode(),
      fallback: config.fallback ?? "fail",
      language,
      model: config.model ?? "small",
      diarize: config.diarize ?? false,
      format: config.format ?? "txt",
      outputDir,
      cacheDir: config.cacheDir ? expandHome(config.cacheDir) : undefined,
      offline: config.offline ?? false,
      keepAudio: config.keepAudio ?? false,
      keepOriginalAudio: config.keepOriginalAudio ?? false,
      chunkSeconds: config.chunkSeconds ?? 55,
      filenameTemplate: config.filenameTemplate ?? "{title}",
      audioQuality: config.audioQuality ?? "best",
      verbose: config.verbose ?? false,
      cookies,
      cookiesFromBrowser,
      browserCookies,
      concurrentFragments: config.parallelDownloads ?? config.concurrentFragments ?? 4,
      retries: config.retries ?? 10,
      fragmentRetries: config.fragmentRetries ?? 10,
      socketTimeout: config.socketTimeout ?? 20,
      downloadTimeoutSeconds: config.downloadTimeoutSeconds ?? 1800,
      convertTimeoutSeconds: config.convertTimeoutSeconds ?? 600,
      asrChunkTimeoutSeconds: config.asrChunkTimeoutSeconds ?? 180,
      proxy: config.proxy,
      rateLimit: config.rateLimit,
      userAgent: config.userAgent,
      logFile: config.logFile ? expandHome(config.logFile) : undefined,
      updateYtDlp: config.updateYtDlp ?? false,
    };
    await installLogger(options.logFile);
    await runPipeline(source, inputKind, options);
  } finally {
    rl.close();
  }
}

const program = new Command();
program
  .name("yt2text")
  .description("Download audio and save local transcripts.")
  .version("0.1.0");

const runCommand = addCommonOptions(
  program.command("run").argument("<url>", "YouTube or yt-dlp supported URL").description("Download and transcribe a URL"),
);
runCommand.action(async (url: string) => {
  const options = await collectOptions(runCommand);
  await installLogger(options.logFile);
  await runPipeline(url, "url", options);
});

const fileCommand = addCommonOptions(program.command("file").argument("<path>", "Local audio/video file"));
fileCommand.action(async (filePath: string) => {
  const options = await collectOptions(fileCommand);
  await installLogger(options.logFile);
  await runPipeline(expandHome(filePath), "file", options);
});

const doctorCommand = addCommonOptions(program.command("doctor").description("Check local dependencies and cache"));
doctorCommand.option("--fix", "Download missing small dependencies where possible", false);
doctorCommand.option("--show-config", "Print the effective options after config and CLI overrides", false);
doctorCommand.action(async () => {
  const options = await collectOptions(doctorCommand);
  await installLogger(options.logFile);
  const paths = await createRuntimePaths(options);
  try {
    const doctorOptions = doctorCommand.opts<{ fix?: boolean; showConfig?: boolean }>();
    await runDoctor(paths, options, Boolean(doctorOptions.fix), Boolean(doctorOptions.showConfig));
  } finally {
    await rm(paths.workDir, { recursive: true, force: true });
  }
});

const configCommand = program
  .command("config")
  .argument("[path]", "Where to write config JSON", defaultConfigPath())
  .option("--print", "Print the default config JSON instead of writing a file", false)
  .description("Write a default JSON config file");
configCommand.action(async (path: string) => {
  if (configCommand.opts<{ print?: boolean }>().print) {
    const { defaultConfig } = await import("./config.js");
    console.log(JSON.stringify(defaultConfig(), null, 2));
    return;
  }
  const target = await writeDefaultConfig(path);
  console.log(target);
});

const watchCommand = program
  .command("watch")
  .argument("[config]", "Watch JSON config file", defaultWatchConfigPath())
  .option("--init", "Write a default watch config file", false)
  .option("--run-once", "Check channels once and exit", false)
  .option("--mark-seen", "Mark currently listed videos as seen without transcribing", false)
  .option("--run-on-start", "Run once immediately before waiting for the next scheduled time", false)
  .description("Watch YouTube channels and transcribe new videos on a schedule");
watchCommand.action(async (path: string) => {
  const options = watchCommand.opts<{
    init?: boolean;
    runOnce?: boolean;
    markSeen?: boolean;
    runOnStart?: boolean;
  }>();
  await runWatch(path, options);
});

function withDefaultCommand(argv: string[]): string[] {
  const knownCommands = new Set(["run", "file", "doctor", "config", "watch", "help"]);
  const first = argv[0];
  if (!first || first === "-h" || first === "--help" || first === "-V" || first === "--version") return argv;
  if (knownCommands.has(first)) return argv;
  return ["run", ...argv];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runInteractive();
      return;
    }
    program.help();
  }

  await program.parseAsync(["node", "yt2text", ...withDefaultCommand(argv)]);
}

main().catch((error) => {
  console.error(explainError(error));
  process.exitCode = 1;
});
