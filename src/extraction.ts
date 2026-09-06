import type { Candidate, CaseData, CaseMaterialKey, TextPage } from "./types";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 500000;
const MAX_XML = 2 * 1024 * 1024;

export function validateFile(file: Pick<File, "name" | "size">) {
  if (!file.size) throw new Error("文件为空，请重新选择。");
  if (file.size > MAX_FILE_BYTES) throw new Error("单个文件不能超过20MB，请拆分或使用手工填写。");
  if (!/\.(pdf|docx|txt|doc|png|jpe?g)$/i.test(file.name)) throw new Error("请选择PDF、DOCX、TXT、DOC或JPG/PNG文件。");
  if (file.name.length > 260) throw new Error("文件名过长，请缩短后重新选择。");
}
function clean(text: string) { return text.replace(/\u0000/g, "").replace(/[\t ]+/g, " ").trim(); }
export function candidatesFromPages(pages: TextPage[], material: CaseMaterialKey, name: string): Candidate[] {
  const candidates: Candidate[] = [];
  const add = (field: keyof CaseData, value: string, page: TextPage, quote: string) => {
    value = value.trim();
    if (!value || value.length > 300 || candidates.length >= 120 || candidates.some(c => c.field === field && c.value === value && c.source.location === page.location)) return;
    candidates.push({ field, value, source: { material, name, location: page.location, quote: quote.slice(0, 500) } });
  };
  // Only explicit labels are offered for roles, dates and money. Never map 原告 to creditor.
  const rules: [keyof CaseData, RegExp][] = [
    ["applicantName", /(?:申请执行人|申请人)[：:]\s*([^，,。；;\n]+)/g],
    ["respondentName", /被执行人[：:]\s*([^，,。；;\n]+)/g],
    ["principal", /(?:本金|借款本金|请求执行本金)[：:]?\s*(?:人民币)?\s*([\d,，]+(?:\.\d{1,2})?)\s*元/g],
    ["effectiveDate", /(?:生效日期|于)[：:]?\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:生效)?/g],
  ];
  for (const page of pages) {
    for (const line of page.text.split("\n")) {
      const trimmed = line.trim();
      const kind = trimmed.match(/民事(?:判决|裁定|调解)书/);
      if (kind) add("basisType", kind[0], page, line);
      if (/^[\u4e00-\u9fff]{2,35}人民法院$/.test(trimmed.replace(/\s/g, ""))) add("court", trimmed.replace(/\s/g, ""), page, line);
      for (const match of trimmed.matchAll(/[（(]\d{4}[）)]\s*[\u4e00-\u9fff\d]{1,20}(?:民初|民终|民特|民再|执)\s*\d+号/g)) add("caseNumber", match[0].replace(/\s/g, ""), page, line);
      for (const [field, pattern] of rules) for (const match of trimmed.matchAll(pattern)) {
        if (field === "effectiveDate" && !/生效/.test(match[0]) && !/生效日期/.test(trimmed)) continue;
        const value = field === "principal" ? match[1].replace(/[,，]/g, "") : field === "effectiveDate" ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : match[1];
        add(field, value, page, line);
      }
    }
  }
  return candidates.slice(0, 120);
}
export async function readMaterial(file: File): Promise<TextPage[]> {
  validateFile(file);
  const ext = file.name.split(".").pop()!.toLowerCase();
  if (["jpg", "jpeg", "png"].includes(ext)) throw new Error("这是图片或扫描件。v1.0未启用OCR，请对照原件手工填写；文件仍可加入材料包。");
  if (ext === "doc") throw new Error("旧版DOC二进制格式暂不解析。请在办公软件中另存为DOCX或文本PDF；可继续手工填写。");
  const bytes = new Uint8Array(await file.arrayBuffer());
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
    if (!pages.length) throw new Error("DOCX无可提取正文，可能只包含扫描图片。请手工填写。");
    return pages;
  }
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")) throw new Error("文件内容不是PDF，请检查文件格式。");
  const pdfjs = await import("pdfjs-dist");
  const { default: workerCode } = await import("pdfjs-dist/build/pdf.worker.min.mjs?raw");
  const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });
  const pdfWorker = pdfjs.PDFWorker.create({ port: worker });
  const task = pdfjs.getDocument({ data: bytes, worker: pdfWorker, useWasm: false, useWorkerFetch: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  // Bound malformed/encrypted/large-document processing; always release workers.
  const timer = window.setTimeout(() => { void task.destroy(); }, 45000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 50) throw new Error("PDF超过50页，请拆分后导入。");
    const pages: TextPage[] = [];
    let characters = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), content = await page.getTextContent();
      let text = "", lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) text += "\n";
        text += item.str + (item.hasEOL ? "\n" : ""); lastY = y;
      }
      text = clean(text); characters += text.length;
      if (characters > MAX_TEXT) throw new Error("PDF文字超过50万字符，请拆分后导入。");
      pages.push({ text, location: `第${n}页` }); page.cleanup();
    }
    if (!pages.some(p => p.text.trim().length > 10)) throw new Error("PDF无足够可提取文字，可能是扫描件。v1.0不做OCR，请手工填写。");
    return pages;
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") throw new Error("PDF已加密。请自行解锁并另存文件后再试，本工具不收集密码。");
    if (e instanceof Error && /PDF|文字|扫描|页/.test(e.message) && !/Invalid PDF/.test(e.message)) throw e;
    throw new Error("PDF读取失败、损坏或超时。请另存为文本PDF，或继续手工填写。");
  } finally { window.clearTimeout(timer); await task.destroy(); pdfWorker.destroy(); worker.terminate(); URL.revokeObjectURL(workerUrl); }
}
