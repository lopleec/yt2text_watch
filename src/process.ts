import { spawn } from "node:child_process";
import { Yt2TextError } from "./errors.js";

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  timeoutMs?: number;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    };

    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            settled = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
            reject(
              new Yt2TextError(
                `${command} timed out after ${Math.round(options.timeoutMs! / 1000)} seconds`,
                "COMMAND_TIMEOUT",
              ),
            );
          }, options.timeoutMs)
        : undefined;

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
      if (!options.quiet) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
      if (!options.quiet) process.stderr.write(text);
    });

    child.on("error", (error) => {
      if (settled) {
        cleanup();
        return;
      }
      settled = true;
      cleanup();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Yt2TextError(`${command} was not found in PATH`, "COMMAND_NOT_FOUND"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        cleanup();
        return;
      }
      settled = true;
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Yt2TextError(
          `${command} exited with code ${code ?? "unknown"}\n${stderr.trim() || stdout.trim()}`,
          "COMMAND_FAILED",
        ),
      );
    });
  });
}
