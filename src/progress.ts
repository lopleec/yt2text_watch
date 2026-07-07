function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

export class ProgressBar {
  private lastRender = 0;
  private lastLinePercent = -1;
  private active = false;
  private readonly isTty = Boolean(process.stderr.isTTY);

  constructor(
    private readonly label: string,
    private readonly width = 28,
  ) {}

  updatePercent(percent: number, detail = ""): void {
    this.update(percent / 100, detail);
  }

  updateBytes(done: number, total?: number, detail = ""): void {
    if (total && total > 0) {
      this.update(done / total, `${formatBytes(done)}/${formatBytes(total)}${detail ? ` ${detail}` : ""}`);
      return;
    }
    this.render(undefined, `${formatBytes(done)}${detail ? ` ${detail}` : ""}`);
  }

  update(ratio: number, detail = ""): void {
    this.render(clamp(ratio), detail);
  }

  finish(detail = "done"): void {
    this.render(1, detail, true);
    if (this.isTty) process.stderr.write("\n");
    this.active = false;
  }

  fail(detail = "failed"): void {
    this.render(undefined, detail, true);
    if (this.isTty) process.stderr.write("\n");
    this.active = false;
  }

  private render(ratio?: number, detail = "", force = false): void {
    const now = Date.now();
    if (!force && now - this.lastRender < 120) return;
    this.lastRender = now;
    this.active = true;

    if (!this.isTty) {
      const percent = ratio === undefined ? -1 : Math.floor(ratio * 100);
      if (!force && percent >= 0 && percent < this.lastLinePercent + 10) return;
      this.lastLinePercent = percent;
      const prefix = percent >= 0 ? `${percent.toString().padStart(3, " ")}%` : "...";
      console.error(`${this.label}: ${prefix}${detail ? ` ${detail}` : ""}`);
      return;
    }

    const percent = ratio === undefined ? undefined : Math.round(ratio * 100);
    const filled = ratio === undefined ? 0 : Math.round(ratio * this.width);
    const bar =
      ratio === undefined
        ? `${".".repeat(Math.min(this.width, 3))}${" ".repeat(Math.max(0, this.width - 3))}`
        : `${"#".repeat(filled)}${"-".repeat(this.width - filled)}`;
    const percentText = percent === undefined ? "   " : `${percent.toString().padStart(3, " ")}%`;
    const text = `${this.label} [${bar}] ${percentText}${detail ? ` ${detail}` : ""}`;
    process.stderr.write(`\r${text.slice(0, process.stderr.columns ?? 120).padEnd(process.stderr.columns ?? 120, " ")}`);
  }
}
