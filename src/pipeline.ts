import { copyFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRuntimePaths } from "./cache.js";
import { expandHome } from "./config.js";
import { downloadMedia, normalizeToWav, prepareLocalMedia } from "./media.js";
import { defaultSystemMode, isSupportedPlatform, platformName } from "./platform.js";
import { assignSpeakers } from "./segments.js";
import { transcribe } from "./asr.js";
import { diarizeWithLocal } from "./local-asr.js";
import { renderOutputStem, writeTranscript } from "./output.js";
import { Yt2TextError } from "./errors.js";
import type { CliOptions, TranscriptDocument } from "./types.js";

function progress(message: string): void {
  console.error(message);
}

export async function runPipeline(input: string, inputKind: "url" | "file", options: CliOptions): Promise<string> {
  if (!isSupportedPlatform()) {
    throw new Yt2TextError(
      `yt2text only supports macOS, Linux, and Windows. Current platform: ${platformName()} (${process.platform}).`,
      "UNSUPPORTED_PLATFORM",
    );
  }

  const effectiveAsr = options.asr ?? "system";
  const effectiveSystemMode = options.systemMode ?? defaultSystemMode();
  if (options.verbose) {
    console.error(`ASR: ${effectiveAsr}; language: ${options.language}; system mode: ${effectiveSystemMode}`);
  }

  const paths = await createRuntimePaths(options);
  try {
    progress(inputKind === "url" ? "[1/5] Downloading audio..." : "[1/5] Preparing local media...");
    const media = inputKind === "url" ? await downloadMedia(input, paths, options) : await prepareLocalMedia(expandHome(input), paths);
    progress(`[2/5] Converting audio: ${media.title}`);
    const normalized = join(paths.workDir, "audio.16k.wav");
    await normalizeToWav(media.mediaPath, normalized, options.convertTimeoutSeconds);

    progress(`[3/5] Transcribing with ${effectiveAsr} ASR (${options.language})...`);
    const transcript = await transcribe(normalized, paths, options);
    progress(`[4/5] Preparing transcript${options.diarize ? " and speaker labels" : ""}...`);
    const segments = options.diarize
      ? assignSpeakers(transcript.segments, await diarizeWithLocal(normalized, paths, options))
      : transcript.segments;

    const documentBase: TranscriptDocument = {
      source: input,
      title: media.title,
      engine: transcript.engine,
      language: options.language,
      segments,
      createdAt: new Date().toISOString(),
    };
    const outputStem = renderOutputStem(documentBase, options.filenameTemplate);
    const audioPath = options.keepAudio ? join(options.outputDir, `${outputStem}.wav`) : undefined;
    if (audioPath) {
      await copyFile(normalized, audioPath);
    }

    let originalAudioPath: string | undefined;
    if (options.keepOriginalAudio) {
      const extension = extname(media.mediaPath) || ".audio";
      originalAudioPath = join(options.outputDir, `${outputStem}${extension}`);
      await copyFile(media.mediaPath, originalAudioPath);
    }

    progress(`[5/5] Writing ${options.format} to ${options.outputDir}...`);
    const outputPath = await writeTranscript(
      {
        ...documentBase,
        audioPath,
        originalAudioPath,
      },
      options.outputDir,
      options.format,
      options.filenameTemplate,
    );

    progress(`Done: ${outputPath}`);
    console.log(outputPath);
    return outputPath;
  } finally {
    await rm(paths.workDir, { recursive: true, force: true });
  }
}
