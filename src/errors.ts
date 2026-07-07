export class Yt2TextError extends Error {
  constructor(
    message: string,
    public readonly code = "YT2TEXT_ERROR",
  ) {
    super(message);
  }
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function explainError(error: unknown): string {
  const err = asError(error);
  const message = err.message;
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (lower.includes("could not find") && lower.includes("cookies")) {
    hints.push("Cookie 读取失败：确认浏览器已安装并登录 YouTube，或改用 --cookies <file> 指定 cookies.txt。");
  }
  if (lower.includes("permission") && lower.includes("cookies")) {
    hints.push("Cookie 权限失败：关闭浏览器后重试，或导出 cookies.txt 后用 --cookies 指定。");
  }
  if (lower.includes("database is locked") || (lower.includes("sqlite") && lower.includes("locked"))) {
    hints.push("Cookie 数据库被浏览器锁定：完全退出浏览器后重试。");
  }
  if (lower.includes("sign in to confirm") || lower.includes("not a bot")) {
    hints.push("YouTube 要求登录/验证：请使用 --cookies-from-browser chrome/safari/firefox，或在交互模式里选择浏览器 cookies。");
  }
  if (lower.includes("http error 403") || lower.includes("forbidden")) {
    hints.push("下载被拒绝：先试浏览器 cookies；如果仍失败，运行 yt2text doctor 检查 yt-dlp，并可用 --update-ytdlp 更新下载器。");
  }
  if (lower.includes("yt-dlp") && lower.includes("not cached") && lower.includes("offline")) {
    hints.push("当前是离线模式但 yt-dlp 尚未缓存：去掉 --offline 让工具自动下载依赖。");
  }
  if (lower.includes("ffmpeg was not found")) {
    hints.push("ffmpeg 不可用：重新 npm install，或安装系统 ffmpeg 后重试。");
  }
  if (lower.includes("swiftc was not found")) {
    hints.push("macOS 系统语音 helper 需要 Swift 编译器：yt2text 会自动尝试打开 Xcode Command Line Tools 安装器；安装完成后重试。");
  }
  if (lower.includes("xcode command line tools installer was opened")) {
    hints.push("请在 macOS 弹出的安装窗口里完成 Xcode Command Line Tools 安装，完成后重新运行刚才的 yt2text 命令。");
  }
  if (lower.includes("xcode-select --install")) {
    hints.push("如果自动打开失败，可手动运行 xcode-select --install。");
  }
  if (lower.includes("tar was not found") || lower.includes("could not extract")) {
    hints.push("模型解压失败：需要系统 tar 支持 .tar.bz2；macOS/Linux 通常自带，Windows 建议安装 bsdtar/libarchive 或先用 --asr system。");
  }
  if (lower.includes("timed out after")) {
    hints.push("任务超时：可以调大 --download-timeout、--convert-timeout 或 --asr-chunk-timeout；网络下载慢时也可设置 --proxy。");
  }
  if (lower.includes("input media file not found")) {
    hints.push("本地文件路径不可读：确认当前目录，或使用绝对路径。");
  }
  if (lower.includes("invalid config")) {
    hints.push("配置文件字段名、类型或枚举值不正确：运行 yt2text config --print 查看可用字段。");
  }
  if (lower.includes("enotfound") || lower.includes("econnreset") || lower.includes("etimedout")) {
    hints.push("网络连接失败：检查代理/网络，或设置 --proxy；依赖和模型只在首次使用时下载。");
  }
  if (lower.includes("whisper") && lower.includes("not cached") && lower.includes("offline")) {
    hints.push("本地 ASR 模型未缓存：去掉 --offline 让工具自动下载模型，或先运行一次 --multilingual。");
  }
  if (lower.includes("sherpa-onnx-node is not installed")) {
    hints.push("本地 ASR 依赖缺失：重新运行 npm install，避免使用 --no-optional；也可以先用 --asr system。");
  }

  return hints.length > 0 ? `${message}\n\n${hints.map((hint) => `Hint: ${hint}`).join("\n")}` : message;
}
