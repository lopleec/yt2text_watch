import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutputFormat, TranscriptDocument, TranscriptSegment } from "./types.js";

function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

function timestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

function srtTimestamp(seconds: number): string {
  return timestamp(seconds).replace(".", ",").padStart(12, "00:");
}

function textLine(segment: TranscriptSegment): string {
  const speaker = segment.speaker ? `${segment.speaker}: ` : "";
  return `[${timestamp(segment.start)} - ${timestamp(segment.end)}] ${speaker}${segment.text}`;
}

function toTxt(document: TranscriptDocument): string {
  return `${document.segments.map(textLine).join("\n")}\n`;
}

function toSrt(document: TranscriptDocument): string {
  return `${document.segments
    .map((segment, index) => {
      const speaker = segment.speaker ? `${segment.speaker}: ` : "";
      return `${index + 1}\n${srtTimestamp(segment.start)} --> ${srtTimestamp(segment.end)}\n${speaker}${segment.text}`;
    })
    .join("\n\n")}\n`;
}

export async function writeTranscript(
  document: TranscriptDocument,
  outputDir: string,
  format: OutputFormat,
  filenameTemplate = "{title}",
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${renderOutputStem(document, filenameTemplate)}.${format}`);
  const body =
    format === "json" ? `${JSON.stringify(document, null, 2)}\n` : format === "srt" ? toSrt(document) : toTxt(document);

  await writeFile(outputPath, body, "utf8");
  return outputPath;
}

export function renderOutputStem(document: TranscriptDocument, template: string): string {
  const createdAt = new Date(document.createdAt);
  const date = Number.isNaN(createdAt.getTime()) ? new Date().toISOString().slice(0, 10) : createdAt.toISOString().slice(0, 10);
  const datetime = Number.isNaN(createdAt.getTime())
    ? new Date().toISOString().replace(/[:.]/g, "-")
    : createdAt.toISOString().replace(/[:.]/g, "-");
  const values: Record<string, string> = {
    title: document.title ?? "transcript",
    language: document.language,
    engine: document.engine,
    date,
    datetime,
    source: document.source,
  };
  const rendered = template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key: string) => values[key] ?? match);
  return sanitizeFilePart(rendered) || "transcript";
}
