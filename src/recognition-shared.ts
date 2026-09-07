import { moneyCents, validDate } from "./domain";
import type { Candidate, CaseData, CaseMaterialKey, TextPage } from "./types";

export const MIN_AUTO_CONFIDENCE = 75;
export function normalizeRecognitionText(text: string) {
  return text.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, "").replace(/[ \t]*([:：])[ \t]*/g, "$1").trim();
}
export function validCandidate(field: keyof CaseData, value: string) {
  if (!value || value.length > (field === "assetClue" || field === "requestSummary" ? 4000 : 300)) return false;
  if (field === "effectiveDate") return validDate(value) && value <= new Date().toISOString().slice(0, 10);
  if (field === "principal") { try { return moneyCents(value) > 0n; } catch { return false; } }
  if (field === "applicantId" || field === "respondentId") return /^(?:\d{17}[\dX]|[0-9A-Z]{18}|\d{15})$/.test(value);
  if (field === "applicantPhone") return /^[+\d()（）\-\s]{5,30}$/.test(value);
  if (field === "applicantType" || field === "respondentType") return ["自然人", "法人或其他组织"].includes(value);
  if (field === "basisType") return ["民事判决书", "民事裁定书", "民事调解书"].includes(value);
  return true;
}

export type RecognitionDocument = { material: CaseMaterialKey; name: string; pages: TextPage[] };
export type Evidence = { document: RecognitionDocument; page: TextPage; raw: string; text: string; confidence?: number };
export function documentLines(document: RecognitionDocument): Evidence[] {
  return document.pages.flatMap(page => (page.lines?.length ? page.lines : page.text.split(/\r?\n/).map(text => ({ text, confidence: page.confidence })))
    .map(line => ({ document, page, raw: line.text, text: normalizeRecognitionText(line.text), confidence: line.confidence ?? page.confidence })).filter(line => line.text));
}
export function evidenceCandidate(field: keyof CaseData, value: string, evidence: Evidence[], safe = true, explanation?: string, requires?: Candidate["requires"]): Candidate {
  const first = evidence[0];
  const ocr = evidence.filter(point => point.page.method === "ocr");
  const confidence = ocr.length ? Math.min(...ocr.map(point => Number.isFinite(point.confidence) ? point.confidence! : 0)) : undefined;
  const valid = validCandidate(field, value);
  const confident = !ocr.length || confidence! >= MIN_AUTO_CONFIDENCE;
  const sameFile = evidence.filter(point => point.document === first.document);
  return {
    field, value, requires, autoFill: safe && valid && confident,
    reason: !safe ? explanation ?? "对应关系尚不明确，请人工核对" : !valid ? "格式或日期需人工核对" : !confident ? "OCR参考分数偏低，请对照原件核对" : explanation,
    source: { material: first.document.material, name: first.document.name, location: [...new Set(sameFile.map(point => point.page.location))].join("、").slice(0, 300),
      quote: [...new Set(evidence.map(point => `${point.document.name} · ${point.page.location}：${point.raw}`))].join("\n").slice(0, 800),
      method: ocr.length ? "ocr" : "text", confidence, value },
  };
}
