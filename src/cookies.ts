import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

interface BrowserCandidate {
  id: string;
  name: string;
  macApps?: string[];
  commands?: string[];
  windowsPaths?: string[];
}

const candidates: BrowserCandidate[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    macApps: ["Google Chrome.app"],
    commands: ["google-chrome", "google-chrome-stable", "chrome"],
    windowsPaths: [
      "Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  {
    id: "safari",
    name: "Safari",
    macApps: ["Safari.app"],
  },
  {
    id: "firefox",
    name: "Firefox",
    macApps: ["Firefox.app"],
    commands: ["firefox"],
    windowsPaths: [
      "Mozilla Firefox\\firefox.exe",
    ],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    macApps: ["Microsoft Edge.app"],
    commands: ["microsoft-edge", "microsoft-edge-stable"],
    windowsPaths: [
      "Microsoft\\Edge\\Application\\msedge.exe",
    ],
  },
  {
    id: "brave",
    name: "Brave",
    macApps: ["Brave Browser.app"],
    commands: ["brave-browser", "brave"],
    windowsPaths: [
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ],
  },
  {
    id: "chromium",
    name: "Chromium",
    macApps: ["Chromium.app"],
    commands: ["chromium", "chromium-browser"],
  },
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of paths) {
    for (const suffix of suffixes) {
      if (await exists(join(dir, `${command}${suffix}`))) return true;
    }
  }
  return false;
}

async function hasMacApp(candidate: BrowserCandidate): Promise<boolean> {
  for (const app of candidate.macApps ?? []) {
    if (await exists(join("/Applications", app))) return true;
    if (await exists(join(homedir(), "Applications", app))) return true;
  }
  return false;
}

async function hasWindowsApp(candidate: BrowserCandidate): Promise<boolean> {
  const roots = [
    process.env.LOCALAPPDATA,
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
  ].filter(Boolean) as string[];

  for (const relative of candidate.windowsPaths ?? []) {
    for (const root of roots) {
      if (await exists(join(root, relative))) return true;
    }
  }

  return false;
}

async function isInstalled(candidate: BrowserCandidate): Promise<boolean> {
  if (process.platform === "darwin") return hasMacApp(candidate);
  if (process.platform === "win32") return hasWindowsApp(candidate);

  for (const command of candidate.commands ?? []) {
    if (await commandExists(command)) return true;
  }
  return false;
}

export function defaultCookiesFromBrowser(): string | undefined {
  return process.platform === "darwin" ? "auto" : undefined;
}

export function knownCookieBrowsers(): Array<{ id: string; name: string }> {
  return candidates.map(({ id, name }) => ({ id, name }));
}

export async function detectCookieBrowsers(): Promise<Array<{ id: string; name: string }>> {
  const detected: Array<{ id: string; name: string }> = [];
  for (const candidate of candidates) {
    if (await isInstalled(candidate)) {
      detected.push({ id: candidate.id, name: candidate.name });
    }
  }
  return detected;
}
