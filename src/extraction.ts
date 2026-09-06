import type { TextPage } from "./types";
import { abortError, createOcr, resourceUrl, throwIfAborted, type ReadOptions } from "./ocr";
export { candidatesFromPages } from "./recognition";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 500000;
const MAX_XML = 2 * 1024 * 1024;

export function validateFile(file: Pick<File, "name" | "size">) {
  if (!file.size) throw new Error("文件为空，请重新选择。");
  if (file.size > MAX_FILE_BYTES) throw new Error("单个文件不能超过20MB，请拆分或使用手工填写。");
  if (!/\.(pdf|docx|txt|doc|png|jpe?g|webp|bmp|tiff?)$/i.test(file.name)) throw new Error("请选择PDF、JPG、PNG、WebP、BMP、TIFF、DOCX或TXT；旧DOC需先另存。HEIC、GIF和SVG请转换为PNG或PDF。");
  if (file.name.length > 260) throw new Error("文件名过长，请缩短后重新选择。");
}
function clean(text: string) { return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[\t ]+/g, " ").trim(); }
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xff || marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
      offset += length;
    }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X") {
      if (bytes[20] & 2) throw new Error("动态WebP不支持整段识别，请将各帧另存为图片。");
      return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (kind === "VP8 ") return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    if (kind === "VP8L") { const bits = view.getUint32(21, true); return { width: 1 + (bits & 16383), height: 1 + ((bits >>> 14) & 16383) }; }
  }
  return null;
}
export function validateImageSize(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > 25000000) throw new Error("图片过大或尺寸异常：每张最多2500万像素、单边最多16000像素，请缩小后重试。");
}
function readable(pages: TextPage[]) {
  if (pages.reduce((sum, page) => sum + page.text.length, 0) > MAX_TEXT) throw new Error("识别文字超过50万字符，请拆分文件。");
  if (!pages.some(page => page.text.trim().length > 2)) throw new Error("未识别到足够文字。请使用清晰、正向、光线均匀的材料，或继续手工填写。");
  return pages;
}
export async function readMaterial(file: File, options: ReadOptions = {}): Promise<TextPage[]> {
  validateFile(file);
  throwIfAborted(options.signal);
  const ext = file.name.split(".").pop()!.toLowerCase();
  if (ext === "doc") throw new Error("旧版DOC二进制格式暂不解析。请在办公软件中另存为DOCX或PDF；可继续手工填写。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(options.signal);
  if (ext === "txt") {
    if (bytes.includes(0)) throw new Error("TXT不是UTF-8纯文本，请另存为UTF-8后重试。");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("TXT编码不支持，请另存为UTF-8。"); }
    if (text.length > MAX_TEXT) throw new Error("文本超过50万字符，请缩减文件。");
    const pages = text.split(/\r?\n/).map((text, i) => ({ text: clean(text), location: `第${i + 1}行` })).filter(p => p.text);
    if (pages.length > 5000) throw new Error("TXT超过5000个非空行，请拆分后导入。");
    if (!pages.length) throw new Error("文件中没有可读取的文字。");
    return pages;
  }
  if (ext === "docx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("文件内容不是有效DOCX，改扩展名不能转换格式。");
    const { unzipSync, strFromU8 } = await import("fflate");
    let xmlBytes: Uint8Array | undefined;
    try {
      const extracted = unzipSync(bytes, { filter: entry => {
        if (entry.name !== "word/document.xml") return false;
        if (entry.originalSize > MAX_XML || entry.originalSize / Math.max(1, entry.size) > 150) throw new Error("文档解压大小或压缩比异常");
        return true;
      } });
      xmlBytes = extracted["word/document.xml"];
    } catch { throw new Error("DOCX损坏、加密或解压规模异常，请另存后重试。"); }
    if (!xmlBytes || xmlBytes.length > MAX_XML) throw new Error("DOCX缺少正文或正文过大。");
    const xml = strFromU8(xmlBytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("文档包含不支持的XML声明。");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("DOCX正文结构损坏。");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    if (doc.getElementsByTagNameNS(ns, "del").length || doc.getElementsByTagNameNS(ns, "ins").length) throw new Error("文档含修订记录，请先在办公软件中核对并接受或拒绝修订，再另存导入。");
    const paragraphs = Array.from(doc.getElementsByTagNameNS(ns, "p"));
    if (paragraphs.length > 5000) throw new Error("DOCX超过5000个段落，请拆分后导入。");
    const pages = paragraphs.map((p, i) => ({ location: `第${i + 1}段`, text: clean(Array.from(p.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("")) })).filter(p => p.text);
    if (pages.reduce((n, p) => n + p.text.length, 0) > MAX_TEXT) throw new Error("文档文字超过50万字符。");
    if (!pages.length) throw new Error("DOCX无可提取正文，可能只包含扫描图片。请导出为PDF或将图片另存后进行OCR。");
    return pages;
  }
  if (ext !== "pdf") {
    const tiff = ext === "tif" || ext === "tiff";
    if (tiff && !((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42) || (bytes[0] === 77 && bytes[1] === 77 && bytes[3] === 42))) throw new Error("文件内容不是支持的TIFF，改扩展名不能转换格式。");
    const dimensions = tiff ? null : imageDimensions(bytes);
    if (!tiff && !dimensions) throw new Error("图片格式无效或已损坏，请另存为JPG、PNG、WebP或BMP。");
    if (dimensions) validateImageSize(dimensions.width, dimensions.height);
    const ocr = await createOcr(options);
    try {
      if (tiff) return readable(await ocr.recognizeTiff(bytes.buffer));
      let bitmap: ImageBitmap;
      try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch { throw new Error("图片无法解码，请检查内容是否损坏或另存为PNG。"); }
      try {
        validateImageSize(bitmap.width, bitmap.height);
        const edge = Math.max(bitmap.width, bitmap.height);
        const scale = edge > 3000 ? 3000 / edge : edge < 1400 ? Math.min(2, 1400 / edge) : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器无法创建图像画布。");
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片转换失败。")), "image/png"));
        throwIfAborted(options.signal);
        try { return readable([await ocr.recognize(png, "第1张图片（OCR）")]); }
        finally { canvas.width = canvas.height = 1; }
      } finally { bitmap.close(); }
    } finally { ocr.close(); }
  }
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")) throw new Error("文件内容不是PDF，请检查文件格式。");
  const pdfjs = await import("pdfjs-dist");
  const { default: workerCode } = await import("pdfjs-dist/build/pdf.worker.min.mjs?raw");
  const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });
  const pdfWorker = pdfjs.PDFWorker.create({ port: worker });
  const task = pdfjs.getDocument({ data: bytes, worker: pdfWorker, useWasm: true, useWorkerFetch: true, useSystemFonts: true,
    cMapUrl: resourceUrl("pdfjs/cmaps/"), cMapPacked: true,
    standardFontDataUrl: resourceUrl("pdfjs/standard_fonts/"), wasmUrl: resourceUrl("pdfjs/wasm/"), verbosity: 0 });
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; void task.destroy(); }, 45000);
  const abort = () => { void task.destroy(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  let ocr: Awaited<ReturnType<typeof createOcr>> | undefined;
  try {
    const pdf = await task.promise;
    window.clearTimeout(timer); throwIfAborted(options.signal);
    if (pdf.numPages > 50) throw new Error("PDF超过50页，请拆分后导入。");
    const pages: TextPage[] = [];
    let characters = 0;
    let pageNumber = 1;
    ocr = await createOcr({ ...options, onProgress: progress => options.onProgress?.({ ...progress, message: `PDF第${pageNumber}/${pdf.numPages}页 · ${progress.message}` }) });
    for (let n = 1; n <= pdf.numPages; n++) {
      pageNumber = n; throwIfAborted(options.signal);
      options.onProgress?.({ message: `正在渲染PDF第${n}/${pdf.numPages}页`, progress: (n - 1) / pdf.numPages });
      const page = await pdf.getPage(n);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(200 / 72, 6000 / Math.max(original.width, original.height), Math.sqrt(8000000 / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const render = page.render({ canvas, viewport, background: "rgb(255,255,255)" });
      const renderTimer = window.setTimeout(() => render.cancel(), 45000);
      try {
        await render.promise; throwIfAborted(options.signal);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PDF页面转图像失败。")), "image/png"));
        const recognized = await ocr.recognize(png, `第${n}页（PDF OCR）`);
        recognized.text = clean(recognized.text); characters += recognized.text.length;
        if (characters > MAX_TEXT) throw new Error("PDF识别文字超过50万字符，请拆分后导入。");
        pages.push(recognized);
      } finally { window.clearTimeout(renderTimer); canvas.width = canvas.height = 1; page.cleanup(); }
    }
    return readable(pages);
  } catch (e) {
    if (options.signal?.aborted) throw abortError();
    if (timedOut) throw new Error("PDF加载超时，请拆分或另存后重试。");
    if (e instanceof Error && e.name === "PasswordException") throw new Error("PDF已加密。请自行解锁并另存文件后再试，本工具不收集密码。");
    if (e instanceof Error && /OCR|PDF|文字|图片|页/.test(e.message) && !/Invalid PDF/.test(e.message)) throw e;
    throw new Error("PDF读取失败、损坏或超时。请另存为PDF，或继续手工填写。");
  } finally {
    window.clearTimeout(timer); options.signal?.removeEventListener("abort", abort); ocr?.close();
    try { await task.destroy(); } finally { pdfWorker.destroy(); worker.terminate(); URL.revokeObjectURL(workerUrl); }
  }
}
