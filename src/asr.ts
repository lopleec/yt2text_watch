import { transcribeWithLocal } from "./local-asr.js";
import { transcribeWithSystem } from "./system-asr.js";
import { asError } from "./errors.js";
import type { CliOptions, RuntimePaths, TranscriptSegment } from "./types.js";

export async function transcribe(
  wavPath: string,
  paths: RuntimePaths,
  options: CliOptions,
): Promise<{ engine: string; segments: TranscriptSegment[] }> {
  const provider = options.asr;

  if (provider === "local") {
    return transcribeWithLocal(wavPath, paths, options);
  }

  try {
    return await transcribeWithSystem(wavPath, paths, options);
  } catch (error) {
    if (options.fallback !== "local") throw error;
    console.error(`System ASR unavailable: ${asError(error).message}`);
    console.error("Falling back to local ASR.");
    return transcribeWithLocal(wavPath, paths, options);
  }
}
