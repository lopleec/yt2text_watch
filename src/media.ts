import { basename, join } from "node:path";
import { access, copyFile } from "node:fs/promises";
import { detectCookieBrowsers } from "./cookies.js";
import { ensureYtDlp, getFfmpegPath } from "./deps.js";
import { asError, Yt2TextError } from "./errors.js";
import { ProgressBar } from "./progress.js";
import { runCommand } from "./process.js";
import type { CliOptions, DownloadResult, RuntimePaths } from "./types.js";

function sanitizeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "audio";
}

function timeoutMs(seconds: number): number | undefined {
  return seconds > 0 ? seconds * 1000 : undefined;
}

function audioFormatSelector(quality: CliOptions["audioQuality"]): string {
  if (quality === "small") return "bestaudio[abr<=64]/bestaudio[abr<=96]/bestaudio/best";
  if (quality === "balanced") return "bestaudio[abr<=160]/bestaudio[abr<=192]/bestaudio/best";
  return "bestaudio/best";
}

async function assertReadable(path: string, kind: "cookies" | "media"): Promise<void> {
  try {
    await access(path);
  } catch {
    if (kind === "media") {
      throw new Yt2TextError(
        `Input media file not found or not readable: ${path}\n\nHint: 检查文件路径是否正确；如果路径里有空格，请用引号包起来。`,
        "INPUT_FILE_NOT_FOUND",
      );
    }

    throw new Yt2TextError(
      `Cookies file not found: ${path}\n\nHint: 用浏览器 cookies 时可以省略 --cookies，改用 --cookies-from-browser chrome/safari/firefox；手动 cookies 文件需要是 Netscape cookies.txt 格式。`,
      "COOKIE_FILE_NOT_FOUND",
    );
  }
}

function explainYtDlpFailure(error: unknown, context: { browser?: string; autoCookies: boolean; noDetectedBrowsers: boolean }): Yt2TextError {
  const message = asError(error).message;
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (context.noDetectedBrowsers) {
    hints.push("没有检测到可用浏览器 cookies。请确认 Chrome/Safari/Firefox 已安装并登录 YouTube，或用 --cookies <cookies.txt>。");
  }
  if (context.browser) {
    hints.push(`刚才尝试读取 ${context.browser} cookies 失败。可以关闭浏览器后重试，或换 --cookies-from-browser safari/firefox。`);
  }
  if (lower.includes("sign in to confirm") || lower.includes("not a bot")) {
    hints.push("YouTube 要求登录验证。请使用浏览器 cookies，或在交互模式里选择已登录 YouTube 的浏览器。");
  }
  if (lower.includes("could not find") && lower.includes("cookies")) {
    hints.push("yt-dlp 没找到该浏览器的 cookies 数据库。确认浏览器已安装，或手动导出 cookies.txt 后用 --cookies 指定。");
  }
  if (lower.includes("database is locked") || lower.includes("permission")) {
    hints.push("浏览器 cookies 可能被锁定或无权限读取。完全退出浏览器后重试。");
  }
  if (lower.includes("http error 403") || lower.includes("forbidden")) {
    hints.push("403 通常是 cookies/yt-dlp 过期或地区/网络限制。可试 --update-ytdlp，或设置 --proxy。");
  }

  return new Yt2TextError(
    `Failed to download audio with yt-dlp.\n\n${message}${hints.length ? `\n\n${hints.map((hint) => `Hint: ${hint}`).join("\n")}` : ""}`,
    "YTDLP_FAILED",
  );
}

function createYtdlpProgressHandler(progress: ProgressBar): (text: string) => void {
  let buffer = "";
  return (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("YT2TEXT_PROGRESS:")) continue;
      const [percentText, downloaded, total, speed, eta] = line.replace("YT2TEXT_PROGRESS:", "").split("|");
      const match = percentText.match(/(\d+(?:\.\d+)?)%/);
      if (!match) continue;
      const details = [downloaded, total && total !== "N/A" ? `of ${total}` : "", speed && speed !== "N/A" ? `at ${speed}` : "", eta && eta !== "N/A" ? `ETA ${eta}` : ""]
        .filter(Boolean)
        .join(" ");
      progress.updatePercent(Number(match[1]), details);
    }
  };
}

export async function downloadMedia(
  url: string,
  paths: RuntimePaths,
  options: CliOptions,
): Promise<DownloadResult> {
  const ytdlp = await ensureYtDlp(paths, options);
  if (options.cookies) {
    await assertReadable(options.cookies, "cookies");
  }
  const template = join(paths.workDir, "%(title).160B [%(id)s].%(ext)s");
  const baseArgs = [
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--progress",
    "--newline",
    "--progress-delta",
    "0.5",
    "--progress-template",
    "download:YT2TEXT_PROGRESS:%(progress._percent_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "--remote-components",
    "ejs:github",
    "--js-runtimes",
    "node",
    "-f",
    audioFormatSelector(options.audioQuality),
    "-N",
    String(options.concurrentFragments),
    "--retries",
    String(options.retries),
    "--fragment-retries",
    String(options.fragmentRetries),
    "--socket-timeout",
    String(options.socketTimeout),
    "-o",
    template,
    "--print",
    "after_move:filepath",
  ];

  if (options.proxy) {
    baseArgs.push("--proxy", options.proxy);
  }
  if (options.rateLimit) {
    baseArgs.push("--limit-rate", options.rateLimit);
  }
  if (options.userAgent) {
    baseArgs.push("--user-agent", options.userAgent);
  }

  const browserCandidates =
    options.cookies || !options.browserCookies
      ? []
      : options.cookiesFromBrowser === "auto"
        ? await detectCookieBrowsers()
        : options.cookiesFromBrowser
          ? [{ id: options.cookiesFromBrowser, name: options.cookiesFromBrowser }]
          : [];

  const attempts = browserCandidates.length > 0 ? browserCandidates : [undefined];
  const noDetectedBrowsers = Boolean(options.browserCookies && options.cookiesFromBrowser === "auto" && browserCandidates.length === 0);
  let lastError: unknown;

  for (const browser of attempts) {
    const args = [...baseArgs];
    const progress = new ProgressBar("Downloading audio");
    const handleProgress = createYtdlpProgressHandler(progress);

    if (options.cookies) {
      args.push("--cookies", options.cookies);
    }

    if (browser) {
      console.error(`Using browser cookies: ${browser.name}`);
      args.push("--cookies-from-browser", browser.id);
    } else if (options.cookiesFromBrowser === "auto") {
      console.error("No supported browser cookies found; trying without cookies.");
    }

    args.push(url);

    try {
      const result = await runCommand(ytdlp, args, {
        quiet: true,
        onStdout: handleProgress,
        onStderr: handleProgress,
        timeoutMs: timeoutMs(options.downloadTimeoutSeconds),
      });
      progress.finish();
      const mediaPath = result.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("YT2TEXT_PROGRESS:"))
        .at(-1);
      if (!mediaPath) {
        throw new Error("yt-dlp did not report an output file path");
      }

      return {
        mediaPath,
        title: sanitizeName(basename(mediaPath).replace(/\.[^.]+$/, "")),
      };
    } catch (error) {
      lastError = error;
      progress.fail();
      if (options.cookiesFromBrowser !== "auto" || !browser) {
        throw explainYtDlpFailure(error, {
          browser: browser?.name,
          autoCookies: options.cookiesFromBrowser === "auto",
          noDetectedBrowsers,
        });
      }
      console.error(`Could not use ${browser.name} cookies; trying another browser.`);
    }
  }

  throw explainYtDlpFailure(lastError ?? new Error("yt-dlp download failed"), {
    autoCookies: options.cookiesFromBrowser === "auto",
    noDetectedBrowsers,
  });
}

export async function prepareLocalMedia(
  inputPath: string,
  paths: RuntimePaths,
): Promise<DownloadResult> {
  await assertReadable(inputPath, "media");
  const title = sanitizeName(basename(inputPath).replace(/\.[^.]+$/, ""));
  const copied = join(paths.workDir, basename(inputPath));
  await copyFile(inputPath, copied);
  return { mediaPath: copied, title };
}

export async function normalizeToWav(inputPath: string, outputPath: string, timeoutSeconds = 0): Promise<string> {
  const ffmpeg = await getFfmpegPath();
  await runCommand(
    ffmpeg,
    ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", outputPath],
    { quiet: true, timeoutMs: timeoutMs(timeoutSeconds) },
  );
  return outputPath;
}

export async function splitWav(
  wavPath: string,
  outputDir: string,
  chunkSeconds: number,
  timeoutSeconds = 0,
): Promise<string[]> {
  if (chunkSeconds <= 0) return [wavPath];

  const ffmpeg = await getFfmpegPath();
  const pattern = join(outputDir, "chunk_%04d.wav");
  await runCommand(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      wavPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSeconds),
      "-c",
      "copy",
      pattern,
    ],
    { quiet: true, timeoutMs: timeoutMs(timeoutSeconds) },
  );

  const { readdir } = await import("node:fs/promises");
  const files = await readdir(outputDir);
  return files
    .filter((file) => /^chunk_\d+\.wav$/.test(file))
    .sort()
    .map((file) => join(outputDir, file));
}
