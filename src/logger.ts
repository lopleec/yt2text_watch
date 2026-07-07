import { mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";

let stream: WriteStream | undefined;

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function installLogger(path?: string): Promise<void> {
  if (!path || stream) return;
  await mkdir(dirname(path), { recursive: true });
  stream = createWriteStream(path, { flags: "a" });

  const originalError = console.error.bind(console);
  const originalLog = console.log.bind(console);

  console.error = (...args: unknown[]) => {
    stream?.write(`[${new Date().toISOString()}] ${args.map(serialize).join(" ")}\n`);
    originalError(...args);
  };

  console.log = (...args: unknown[]) => {
    stream?.write(`[${new Date().toISOString()}] ${args.map(serialize).join(" ")}\n`);
    originalLog(...args);
  };
}
