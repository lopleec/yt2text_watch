export type AsrProviderName = "system" | "local";
export type SystemMode = "online" | "offline" | "auto";
export type FallbackMode = "local" | "fail";
export type OutputFormat = "txt" | "json" | "srt";
export type WhisperModel = "tiny" | "base" | "small" | "medium";
export type AudioQuality = "best" | "balanced" | "small";

export interface CliOptions {
  configPath: string;
  asr?: AsrProviderName;
  systemMode: SystemMode;
  fallback: FallbackMode;
  language: string;
  model: WhisperModel;
  diarize: boolean;
  format: OutputFormat;
  outputDir: string;
  cacheDir?: string;
  offline: boolean;
  keepAudio: boolean;
  keepOriginalAudio: boolean;
  chunkSeconds: number;
  filenameTemplate: string;
  audioQuality: AudioQuality;
  verbose: boolean;
  cookies?: string;
  cookiesFromBrowser?: string;
  browserCookies: boolean;
  concurrentFragments: number;
  retries: number;
  fragmentRetries: number;
  socketTimeout: number;
  downloadTimeoutSeconds: number;
  convertTimeoutSeconds: number;
  asrChunkTimeoutSeconds: number;
  proxy?: string;
  rateLimit?: string;
  userAgent?: string;
  logFile?: string;
  updateYtDlp: boolean;
}

export interface RuntimePaths {
  cacheDir: string;
  toolsDir: string;
  modelsDir: string;
  workDir: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  speaker?: string;
}

export interface TranscriptDocument {
  source: string;
  title?: string;
  audioPath?: string;
  originalAudioPath?: string;
  engine: string;
  language: string;
  segments: TranscriptSegment[];
  createdAt: string;
}

export interface SpeakerSegment {
  start: number;
  end: number;
  speaker: string;
}

export interface DownloadResult {
  mediaPath: string;
  title: string;
}
