import { centsText, FIELD_LABELS, invalidateCase, moneyCents, validDate } from "./domain";
import type { AppState, Candidate, CaseData, CaseMaterialKey, TextPage } from "./types";

export const MIN_AUTO_CONFIDENCE = 75;

export function normalizeRecognitionText(text: string) {
  return text.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, "").replace(/[ \t]*([:：])[ \t]*/g, "$1").trim();
}

export function sameFieldValue(field: keyof CaseData, first: string, second: string) {
  if (field === "principal") { try { return moneyCents(first) === moneyCents(second); } catch { /* malformed values stay distinct */ } }
  return first === second;
}

function validCandidate(field: keyof CaseData, value: string) {
  if (!value || value.length > (field === "assetClue" || field === "requestSummary" ? 4000 : 300)) return false;
  if (field === "effectiveDate") return validDate(value) && value <= new Date().toISOString().slice(0, 10);
  if (field === "principal") { try { return moneyCents(value) > 0n; } catch { return false; } }
  if (field === "applicantId" || field === "respondentId") return /^(?:\d{17}[\dX]|[0-9A-Z]{18}|\d{15})$/.test(value);
  if (field === "applicantPhone") return /^[+\d()（）\-\s]{5,30}$/.test(value);
  if (field === "applicantType" || field === "respondentType") return ["自然人", "法人或其他组织"].includes(value);
  if (field === "basisType") return ["民事判决书", "民事裁定书", "民事调解书"].includes(value);
  return true;
}

export function candidatesFromPages(pages: TextPage[], material: CaseMaterialKey, name: string): Candidate[] {
  const candidates: Candidate[] = [];
  const add = (field: keyof CaseData, value: string, page: TextPage, quote: string, confidence?: number, safe = true) => {
    value = value.trim();
    if (!value || value.length > (field === "requestSummary" || field === "assetClue" ? 4000 : 300) || candidates.length >= 120 || candidates.some(c => c.field === field && c.value === value && c.source.location === page.location)) return;
    const valid = validCandidate(field, value);
    const confident = page.method !== "ocr" || (confidence !== undefined && confidence >= MIN_AUTO_CONFIDENCE);
    candidates.push({ field, value, source: { material, name, location: page.location, quote: quote.slice(0, 500), method: page.method ?? "text", confidence, value },
      autoFill: safe && valid && confident, reason: !safe ? "上下文不足，请人工决定是否采纳" : !valid ? "格式或日期需人工核对" : !confident ? "OCR参考分数偏低，请对照原件核对" : undefined });
  };
  let role: "applicant" | "respondent" | null = null;
  let inDisposition = false;
  let uncertainSection = false;
  for (const page of pages) {
    const lines = page.lines?.length ? page.lines : page.text.split("\n").map(text => ({ text, confidence: page.confidence }));
    for (const line of lines) {
      const raw = line.text, text = normalizeRecognitionText(raw);
      const confidence = line.confidence ?? page.confidence;
      const put = (field: keyof CaseData, value: string, safe = true) => add(field, value, page, raw, confidence, safe);
      if (/判决如下|裁定如下|调解协议如下/.test(text)) { inDisposition = true; uncertainSection = false; role = null; }
      if (/诉讼请求|诉称|事实与理由|本院认为|本院查明/.test(text)) { role = null; inDisposition = false; uncertainSection = true; }
      if (/^(?:原告|被告|上诉人|被上诉人|委托|法定代表人|代理人|审判|书记员)/.test(text)) role = null;
      const kind = text.match(/^民事(?:判决|裁定|调解)书$/);
      if (kind) put("basisType", kind[0]);
      const court = text.match(/^(?:文书作出法院|作出法院|法院)[:：]\s*([\u3400-\u9fff]{2,35}人民法院)$/) ?? text.match(/^([\u3400-\u9fff]{2,35}人民法院)$/);
      if (court) put("court", court[1]);
      for (const match of text.matchAll(/[（(]\s*\d{4}\s*[）)]\s*[\u3400-\u9fff\d\s]{1,25}(?:民初|民终|民特|民再|执)\s*\d+\s*号/g)) put("caseNumber", match[0].replace(/\s/g, "").replace("(", "（").replace(")", "）"));
      const party = text.match(/^(申请执行人|申请人|被执行人)(?:姓名或名称|姓名|名称)?\s*[:：]\s*([^,，。;；\n]+)/);
      if (party) {
        role = party[1] === "被执行人" ? "respondent" : "applicant";
        put(`${role}Name`, party[2].trim());
      }
      const labeledFields: [keyof CaseData, RegExp][] = [
        ["executionCourt", /^拟申请执行法院[:：]\s*([\u3400-\u9fff]{2,35}人民法院)/],
        ["requestSummary", /^(?:请求事项简述|申请执行请求|执行请求)[:：]\s*(.+)/],
        ["assetClue", /^财产线索[:：]\s*(.+)/],
        ["applicantType", /^(?:申请执行人|申请人)(?:主体)?类型[:：]\s*(自然人|法人或其他组织)/],
        ["respondentType", /^被执行人(?:主体)?类型[:：]\s*(自然人|法人或其他组织)/],
        ["applicantId", /^(?:申请执行人|申请人)(?:证件号码|身份证(?:件)?号码|统一社会信用代码)[:：]\s*([\dA-Za-z\s]+)/],
        ["respondentId", /^被执行人(?:证件号码|身份证(?:件)?号码|统一社会信用代码)[:：]\s*([\dA-Za-z\s]+)/],
        ["applicantPhone", /^(?:申请执行人|申请人)(?:联系电话|电话|手机号)[:：]\s*([+\d()（）\-\s]+)/],
        ["applicantAddress", /^(?:申请执行人|申请人)(?:送达地址|地址|住址|住所地)[:：]\s*(.+)/],
        ["respondentAddress", /^被执行人(?:已知地址|地址|住址|住所地)[:：]\s*(.+)/],
      ];
      for (const [field, pattern] of labeledFields) {
        const match = text.match(pattern);
        if (match) put(field, field.endsWith("Id") ? match[1].replace(/\s/g, "").toUpperCase() : match[1].trim());
      }
      if (role) {
        const id = text.match(/(?:^|[,，;；])\s*(?:证件号码|公民身份号码|身份证(?:件)?号码|统一社会信用代码)[:：]\s*([\dA-Za-z\s]+)/);
        const address = text.match(/(?:^|[,，;；])\s*(?:送达地址|住址|住所地|地址)[:：]\s*(.+)/);
        const type = text.match(/^主体类型[:：]\s*(自然人|法人或其他组织)/);
        if (id) put(`${role}Id`, id[1].replace(/\s/g, "").toUpperCase());
        if (address) put(`${role}Address`, address[1].trim());
        if (type) put(`${role}Type`, type[1]);
        if (role === "applicant") {
          const phone = text.match(/(?:^|[,，;；])\s*(?:联系电话|电话|手机号)[:：]\s*([+\d()（）\-\s]+)/);
          if (phone) put("applicantPhone", phone[1].trim());
        }
      }
      for (const match of text.matchAll(/(?:生效日期[:：]?\s*|于\s*)(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?\s*(?:生效)?/g)) {
        if (!/生效日期/.test(match[0]) && !/生效$/.test(match[0])) continue;
        put("effectiveDate", `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`, !uncertainSection);
      }
      for (const match of text.matchAll(/(?:请求执行本金|请求本金|借款本金|本金)[:：]?\s*(?:人民币)?\s*([\d,，]+(?:\.\d{1,2})?)\s*(万)?元/g)) {
        let value = match[1].replace(/[,，]/g, "");
        if (match[2]) { try { value = centsText(moneyCents(value) * 10000n); } catch { continue; } }
        const explicit = /^(?:请求执行本金|请求本金|借款本金|本金)[:：]?/.test(text);
        put("principal", value, (explicit && !uncertainSection) || inDisposition);
      }
    }
  }
  return candidates;
}

export function automaticFill(state: AppState, candidates: Candidate[]): AppState {
  const accepted: Candidate[] = [];
  for (const field of Object.keys(FIELD_LABELS) as (keyof CaseData)[]) {
    // Nonempty values and deliberate clears are never overwritten by a later OCR run.
    if (state.caseData[field].trim() || state.userEdited[field]) continue;
    const group = candidates.filter(c => c.field === field);
    if (!group.length || group.some(c => !sameFieldValue(field, group[0].value, c.value))) continue;
    const candidate = group.find(c => c.autoFill !== false && validCandidate(field, c.value) && (c.source.method !== "ocr" || (c.source.confidence ?? 0) >= MIN_AUTO_CONFIDENCE));
    if (candidate) accepted.push(candidate);
  }
  if (!accepted.length) return state;
  const next = invalidateCase(state);
  next.caseData = { ...state.caseData }; next.sources = { ...state.sources };
  for (const candidate of accepted) { next.caseData[candidate.field] = candidate.value; next.sources[candidate.field] = candidate.source; }
  return next;
}
