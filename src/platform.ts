import type { AsrProviderName } from "./types.js";

export function isSupportedPlatform(): boolean {
  return process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";
}

export function defaultAsrProvider(): AsrProviderName {
  return process.platform === "linux" ? "local" : "system";
}

export function defaultSystemMode(): "online" | "offline" {
  return process.platform === "darwin" || process.platform === "win32" ? "offline" : "online";
}

export function platformName(): string {
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "linux") return "Linux";
  if (process.platform === "win32") return "Windows";
  return process.platform;
}

export function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export function ytdlpReleaseUrl(): string {
  if (process.platform === "darwin") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }

  if (process.platform === "win32") {
    if (process.arch === "arm64") {
      return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_arm64.exe";
    }
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  }

  if (process.platform === "linux") {
    if (process.arch === "arm64") {
      return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64";
    }
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  }

  throw new Error(`Unsupported platform: ${process.platform}. yt2text supports macOS, Linux, and Windows only.`);
}
