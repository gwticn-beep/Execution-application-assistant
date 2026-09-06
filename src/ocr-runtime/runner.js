/* Runs entirely in a dedicated worker. Its nested Tesseract worker is stopped with it. */
self.window = self;
importScripts("./tesseract.min.js");
let engine;
let jobId = 0;
const progress = (message, fraction) => self.postMessage({ type: "progress", id: jobId, message, progress: fraction });
const fail = () => self.postMessage({ type: "error", id: jobId, message: "OCR程序或模型读取失败，请检查网络或重新加载页面；材料没有上传，也没有填入本次结果。" });
const checkSize = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > 25000000) throw new Error("图片尺寸不支持：每张最多2500万像素、单边最多16000像素，请缩小后重试。");
};
const cleanText = text => String(text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
const score = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
async function recognize(image, location) {
  const { data } = await engine.recognize(image, { rotateAuto: true }, { text: true, blocks: true });
  const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({ text: cleanText(line.text), confidence: score(line.confidence) }))));
  return { location, text: cleanText(data.text), method: "ocr", confidence: score(data.confidence), lines };
}
self.onmessage = async ({ data }) => {
  jobId = data.id;
  try {
    if (data.type === "init") {
      const base = new URL("./", self.location.href).href;
      engine = await Tesseract.createWorker(["chi_sim", "eng"], 1, {
        workerPath: `${base}worker.min.js`, corePath: `${base}core`, langPath: `${base}lang`,
        workerBlobURL: false, cacheMethod: "write", cachePath: "execution-v11-tesseract7-best-int", gzip: true,
        logger: message => progress(message.status === "recognizing text" ? "正在识别文字" : message.status.includes("language") ? "正在加载中文和英文模型" : "正在准备本地OCR引擎", message.progress),
        errorHandler: fail,
      });
      await engine.setParameters({ tessedit_pageseg_mode: "3", user_defined_dpi: "200" });
      self.postMessage({ type: "ready", id: jobId });
    } else if (data.type === "recognize") {
      if (!engine) throw new Error("OCR引擎尚未准备完成。");
      self.postMessage({ type: "result", id: jobId, pages: [await recognize(data.bytes, data.location)] });
    } else if (data.type === "tiff") {
      if (!engine) throw new Error("OCR引擎尚未准备完成。");
      importScripts("./pako.min.js", "./utif.js");
      const frames = UTIF.decode(data.bytes);
      if (!frames.length || frames.length > 50) throw new Error("TIFF须为1至50页，请拆分后重试。");
      if (typeof OffscreenCanvas === "undefined") throw new Error("当前浏览器无法转换TIFF，请另存为PNG、JPG或PDF。");
      const pages = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        checkSize(frame.t256?.[0], frame.t257?.[0]);
        const samples = frame.t277?.[0] ?? 1;
        if (samples > 4 || (frame.t258 ?? [8]).some(depth => depth > 16)) throw new Error("TIFF颜色通道或位深不支持，请另存PNG后重试。");
        progress(`正在处理TIFF第${i + 1}/${frames.length}页`, i / frames.length);
        UTIF.decodeImage(data.bytes, frame, frames);
        const canvas = new OffscreenCanvas(frame.width, frame.height);
        const context = canvas.getContext("2d");
        context.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)), frame.width, frame.height), 0, 0);
        const png = await canvas.convertToBlob({ type: "image/png" });
        pages.push(await recognize(await png.arrayBuffer(), `第${i + 1}页（TIFF OCR）`));
        frame.data = null; canvas.width = canvas.height = 1;
        if (pages.reduce((sum, page) => sum + page.text.length, 0) > 500000) throw new Error("识别文字超过50万字符，请拆分文件。");
        self.postMessage({ type: "page-done", id: jobId, page: i + 1, total: frames.length });
      }
      self.postMessage({ type: "result", id: jobId, pages });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: jobId, message: error instanceof Error && /TIFF|图片尺寸|OCR引擎|识别文字/.test(error.message) ? error.message : "OCR识别失败或图片损坏，请另存清晰的图片或PDF后重试。已有手工内容保持不变。" });
  }
};
