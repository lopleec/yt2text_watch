import type { SpeakerSegment, TranscriptSegment } from "./types.js";

export function mergeWordSegments(words: TranscriptSegment[]): TranscriptSegment[] {
  const sorted = words
    .filter((word) => word.text.trim())
    .sort((a, b) => a.start - b.start);

  const merged: TranscriptSegment[] = [];
  for (const word of sorted) {
    const previous = merged.at(-1);
    const gap = previous ? word.start - previous.end : Number.POSITIVE_INFINITY;
    const candidateLength = previous ? `${previous.text} ${word.text}`.length : 0;

    if (!previous || gap > 0.85 || candidateLength > 180) {
      merged.push({ ...word, text: word.text.trim() });
      continue;
    }

    previous.end = Math.max(previous.end, word.end);
    previous.text = `${previous.text} ${word.text.trim()}`;
    if (word.confidence !== undefined) {
      previous.confidence =
        previous.confidence === undefined ? word.confidence : Math.min(previous.confidence, word.confidence);
    }
  }

  return merged;
}

export function assignSpeakers(
  transcript: TranscriptSegment[],
  speakers: SpeakerSegment[],
): TranscriptSegment[] {
  return transcript.map((segment) => {
    let bestSpeaker: string | undefined;
    let bestOverlap = 0;

    for (const speaker of speakers) {
      const overlap = Math.max(0, Math.min(segment.end, speaker.end) - Math.max(segment.start, speaker.start));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = speaker.speaker;
      }
    }

    return bestSpeaker ? { ...segment, speaker: bestSpeaker } : segment;
  });
}
