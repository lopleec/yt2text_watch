import { createRequire } from "node:module";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { downloadFile } from "./download-file.js";
import { ProgressBar } from "./progress.js";
import { runCommand } from "./process.js";
import type { CliOptions, RuntimePaths, SpeakerSegment, TranscriptSegment, WhisperModel } from "./types.js";
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

async function nonEmptyFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function extractTar(archive: string, outputDir: string): Promise<void> {
  try {
    await runCommand("tar", ["-xjf", archive, "-C", outputDir], { quiet: true });
  } catch (error) {
    throw new Yt2TextError(
      `Could not extract ${archive}. Install a tar implementation with bzip2 support and retry.\n${asError(error).message}`,
      "EXTRACT_FAILED",
    );
  }
}

function modelFolder(model: WhisperModel): string {
  return `sherpa-onnx-whisper-${model}`;
}

async function whisperModelReady(folder: string, model: WhisperModel): Promise<boolean> {
  return (
    (await nonEmptyFile(join(folder, `${model}-encoder.int8.onnx`))) &&
    (await nonEmptyFile(join(folder, `${model}-decoder.int8.onnx`))) &&
    (await nonEmptyFile(join(folder, `${model}-tokens.txt`)))
  );
}

async function ensureWhisperModel(paths: RuntimePaths, options: CliOptions): Promise<string> {
  const folder = join(paths.modelsDir, modelFolder(options.model));
  if (await whisperModelReady(folder, options.model)) return folder;

  if (options.offline) {
    throw new Yt2TextError(`Whisper ${options.model} model is not cached and --offline was set`, "MISSING_MODEL");
  }

  if (await exists(folder)) {
    console.error(`Removing incomplete local ASR model cache: ${folder}`);
    await rm(folder, { recursive: true, force: true });
  }
  await mkdir(paths.modelsDir, { recursive: true });
  const archive = join(paths.modelsDir, `${modelFolder(options.model)}.tar.bz2`);
  const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${modelFolder(options.model)}.tar.bz2`;
  console.error(`Downloading local ASR model ${options.model}`);
  await downloadFile(url, archive, `Downloading Whisper ${options.model}`);
  await extractTar(archive, paths.modelsDir);
  await rm(archive, { force: true });
  if (!(await whisperModelReady(folder, options.model))) {
    throw new Yt2TextError(`Downloaded Whisper ${options.model} model is incomplete`, "MISSING_MODEL");
  }
  return folder;
}

async function ensureVadModel(paths: RuntimePaths, options: CliOptions): Promise<string> {
  const model = join(paths.modelsDir, "silero_vad.onnx");
  if (await nonEmptyFile(model)) return model;
  if (options.offline) throw new Yt2TextError("VAD model is not cached and --offline was set", "MISSING_MODEL");
  await downloadFile("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx", model, "Downloading VAD model");
  if (!(await nonEmptyFile(model))) throw new Yt2TextError("Downloaded VAD model is empty", "MISSING_MODEL");
  return model;
}

function loadSherpa(): any {
  try {
    return require("sherpa-onnx-node");
  } catch (error) {
    throw new Yt2TextError(
      "sherpa-onnx-node is not installed for this platform; reinstall without --no-optional or use --asr system.",
      "MISSING_DEPENDENCY",
    );
  }
}

function whisperLanguage(locale: string): string | undefined {
  const normalized = locale.trim().toLowerCase();
  if (!normalized || normalized === "auto") return undefined;
  return normalized.split(/[-_]/)[0];
}

export async function transcribeWithLocal(
  wavPath: string,
  paths: RuntimePaths,
  options: CliOptions,
): Promise<{ engine: string; segments: TranscriptSegment[] }> {
  const sherpa = loadSherpa();
  const modelDir = await ensureWhisperModel(paths, options);
  const vadModel = await ensureVadModel(paths, options);
  const prefix = options.model;

  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: join(modelDir, `${prefix}-encoder.int8.onnx`),
        decoder: join(modelDir, `${prefix}-decoder.int8.onnx`),
        language: whisperLanguage(options.language),
        task: "transcribe",
      },
      tokens: join(modelDir, `${prefix}-tokens.txt`),
      numThreads: Math.max(1, Math.min(4, Math.floor((await import("node:os")).cpus().length / 2))),
      provider: "cpu",
      debug: 0,
    },
  });

  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: vadModel,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 15,
        windowSize: 512,
      },
      sampleRate: 16000,
      debug: false,
      numThreads: 1,
    },
    120,
  );

  const wave = sherpa.readWave(wavPath);
  const segments: TranscriptSegment[] = [];
  const windowSize = vad.config.sileroVad.windowSize;
  const progress = new ProgressBar("Transcribing audio");

  const drain = () => {
    while (!vad.isEmpty()) {
      const segment = vad.front();
      vad.pop();
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: segment.samples, sampleRate: wave.sampleRate });
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      const text = String(result.text ?? "").trim();
      if (!text) continue;
      const start = segment.start / wave.sampleRate;
      segments.push({
        start,
        end: start + segment.samples.length / wave.sampleRate,
        text,
      });
    }
  };

  try {
    for (let offset = 0; offset < wave.samples.length; offset += windowSize) {
      vad.acceptWaveform(wave.samples.subarray(offset, offset + windowSize));
      drain();
      progress.update(offset / wave.samples.length);
    }
    vad.flush();
    drain();
    progress.finish();
  } catch (error) {
    progress.fail();
    throw error;
  }

  return { engine: `sherpa-onnx-whisper-${options.model}`, segments };
}

export async function diarizeWithLocal(
  wavPath: string,
  paths: RuntimePaths,
  options: CliOptions,
): Promise<SpeakerSegment[]> {
  const sherpa = loadSherpa();
  const segmentation = await ensureDiarizationSegmentation(paths, options);
  const embedding = await ensureDiarizationEmbedding(paths, options);
  const diarizer = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: join(segmentation, "model.onnx") } },
    embedding: { model: embedding },
    clustering: { numClusters: -1, threshold: 0.5 },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });

  const wave = sherpa.readWave(wavPath);
  const raw = diarizer.process(wave.samples) as Array<Record<string, unknown>>;
  return raw.map((segment, index) => ({
    start: Number(segment.start ?? segment.begin ?? 0),
    end: Number(segment.end ?? segment.stop ?? 0),
    speaker: normalizeSpeaker(segment.speaker ?? segment.label ?? segment.cluster ?? index),
  }));
}

async function ensureDiarizationSegmentation(paths: RuntimePaths, options: CliOptions): Promise<string> {
  const folder = join(paths.modelsDir, "sherpa-onnx-pyannote-segmentation-3-0");
  if (await nonEmptyFile(join(folder, "model.onnx"))) return folder;
  if (options.offline) throw new Yt2TextError("Diarization segmentation model is not cached", "MISSING_MODEL");

  if (await exists(folder)) {
    console.error(`Removing incomplete diarization segmentation cache: ${folder}`);
    await rm(folder, { recursive: true, force: true });
  }
  const archive = join(paths.modelsDir, `${basename(folder)}.tar.bz2`);
  console.error("Downloading speaker diarization segmentation model");
  await downloadFile(
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    archive,
    "Downloading diarization segmentation",
  );
  await extractTar(archive, paths.modelsDir);
  await rm(archive, { force: true });
  if (!(await nonEmptyFile(join(folder, "model.onnx")))) {
    throw new Yt2TextError("Downloaded diarization segmentation model is incomplete", "MISSING_MODEL");
  }
  return folder;
}

async function ensureDiarizationEmbedding(paths: RuntimePaths, options: CliOptions): Promise<string> {
  const model = join(paths.modelsDir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");
  if (await nonEmptyFile(model)) return model;
  if (options.offline) throw new Yt2TextError("Diarization embedding model is not cached", "MISSING_MODEL");

  console.error("Downloading speaker diarization embedding model");
  await downloadFile(
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
    model,
    "Downloading diarization embedding",
  );
  if (!(await nonEmptyFile(model))) throw new Yt2TextError("Downloaded diarization embedding model is empty", "MISSING_MODEL");
  return model;
}

function normalizeSpeaker(value: unknown): string {
  const raw = String(value);
  const match = raw.match(/\d+/);
  const index = match ? Number(match[0]) + 1 : 1;
  return `Speaker ${index}`;
}
