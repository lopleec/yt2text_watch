import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CliOptions, RuntimePaths } from "./types.js";

function defaultCacheDir(): string {
  if (process.env.YT2TEXT_CACHE_DIR) return process.env.YT2TEXT_CACHE_DIR;

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "yt2text");
  }

  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "yt2text");
  }

  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "yt2text");
}

export async function createRuntimePaths(options: CliOptions): Promise<RuntimePaths> {
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const toolsDir = join(cacheDir, "tools");
  const modelsDir = join(cacheDir, "models");
  const workDir = join(tmpdir(), `yt2text-${randomUUID()}`);

  await Promise.all([
    mkdir(toolsDir, { recursive: true }),
    mkdir(modelsDir, { recursive: true }),
    mkdir(workDir, { recursive: true }),
    mkdir(options.outputDir, { recursive: true }),
  ]);

  return { cacheDir, toolsDir, modelsDir, workDir };
}
