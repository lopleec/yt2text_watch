import { access, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { downloadFile } from "./download-file.js";
import { executableName, ytdlpReleaseUrl } from "./platform.js";
import { runCommand } from "./process.js";
import type { CliOptions, RuntimePaths } from "./types.js";
import { asError, Yt2TextError } from "./errors.js";

const require = createRequire(import.meta.url);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand(command, ["--version"], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export async function ensureYtDlp(paths: RuntimePaths, options: CliOptions): Promise<string> {
  const localPath = join(paths.toolsDir, executableName("yt-dlp"));
  if ((await exists(localPath)) && !options.updateYtDlp) return localPath;

  if ((await commandExists("yt-dlp")) && !options.updateYtDlp) return "yt-dlp";

  if (options.offline) {
    throw new Yt2TextError("yt-dlp is not cached and --offline was set", "MISSING_DEPENDENCY");
  }

  if (options.updateYtDlp) {
    await rm(localPath, { force: true });
  }
  console.error(`Downloading yt-dlp to ${localPath}`);
  await downloadFile(ytdlpReleaseUrl(), localPath, "Downloading yt-dlp");
  return localPath;
}

export async function getFfmpegPath(): Promise<string> {
  try {
    const ffmpeg = require("@ffmpeg-installer/ffmpeg") as { path: string };
    if (ffmpeg.path) return ffmpeg.path;
  } catch {
    // Fall through to PATH.
  }

  if (await commandExists("ffmpeg")) return "ffmpeg";
  throw new Yt2TextError("ffmpeg was not found", "MISSING_DEPENDENCY");
}

export async function ensureMacosSwiftc(options: Pick<CliOptions, "offline">): Promise<void> {
  if (process.platform !== "darwin") return;
  if (await commandExists("swiftc")) return;

  if (options.offline) {
    throw new Yt2TextError("swiftc is missing and --offline was set", "MISSING_DEPENDENCY");
  }

  console.error("Xcode Command Line Tools are required for macOS system ASR. Opening Apple's installer...");
  try {
    await runCommand("xcode-select", ["--install"], { quiet: true });
  } catch (error) {
    const message = asError(error).message;
    const lower = message.toLowerCase();
    const installerAlreadyActive =
      lower.includes("install requested") ||
      lower.includes("already installed") ||
      lower.includes("software update") ||
      lower.includes("currently being installed");

    if (!installerAlreadyActive) {
      throw new Yt2TextError(
        `Could not start Xcode Command Line Tools installer.\n${message}\n\nRun manually: xcode-select --install`,
        "MISSING_DEPENDENCY",
      );
    }
  }

  if (await commandExists("swiftc")) return;

  throw new Yt2TextError(
    "Xcode Command Line Tools installer was opened. Finish the macOS installation, then rerun yt2text.",
    "MISSING_DEPENDENCY",
  );
}
