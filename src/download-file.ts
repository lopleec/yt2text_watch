import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Yt2TextError } from "./errors.js";
import { ProgressBar } from "./progress.js";

export async function downloadFile(url: string, destination: string, label?: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const tmp = `${destination}.tmp`;

  const response = await fetch(url, {
    headers: { "user-agent": "yt2text/0.1" },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Yt2TextError(`Failed to download ${url}: HTTP ${response.status}`, "DOWNLOAD_FAILED");
  }

  await rm(tmp, { force: true });
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : undefined;
  let downloaded = 0;
  const progress = new ProgressBar(label ?? "Downloading file");
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      progress.updateBytes(downloaded, total);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(tmp));
    progress.finish();
  } catch (error) {
    progress.fail();
    throw error;
  }

  await rename(tmp, destination);
  if (process.platform !== "win32") {
    await chmod(destination, 0o755);
  }
}
