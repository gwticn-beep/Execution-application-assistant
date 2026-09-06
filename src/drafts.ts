import { createInitialState, FIELD_LABELS, CHECKLIST, REVIEW_ITEMS, compute, validDate, moneyCents } from "./domain";
import type { AppState, CaseData, CaseMaterialKey, CaseMaterials, DraftData, MaterialIndex, ScopeKey, Source } from "./types";

export const MAX_DRAFT_BYTES = 1024 * 1024;
export const MATERIAL_KEYS: CaseMaterialKey[] = ["firstInstance", "secondInstance", "identity"];
export const emptyMaterials = (): CaseMaterials => ({ firstInstance: null, secondInstance: null, identity: null });
function object(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label}格式错误，应为对象。`);
  return v as Record<string, unknown>;
}
function string(v: unknown, label: string, max = 300): string {
  if (v === undefined) return "";
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error(`${label}类型、长度或字符不正确。`);
  return v;
}
function source(v: unknown, field: keyof CaseData): Source {
  const o = object(v, "字段来源");
  if (!MATERIAL_KEYS.includes(o.material as CaseMaterialKey)) throw new Error("材料来源类别不正确。");
  if (o.method !== undefined && o.method !== "ocr" && o.method !== "text") throw new Error("字段来源的识别方式不正确。");
  if (o.confidence !== undefined && (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 100)) throw new Error("OCR参考分数不正确。");
  return { material: o.material as CaseMaterialKey, name: string(o.name, "来源文件名"), location: string(o.location, "来源位置"), quote: string(o.quote, "原文摘录", 800),
    method: o.method as Source["method"], confidence: o.confidence as number | undefined, value: o.value === undefined ? undefined : string(o.value, "原识别值", field === "requestSummary" || field === "assetClue" ? 4000 : 300) };
}
export function makeDraft(state: AppState, materials: CaseMaterials): DraftData {
  const index = Object.fromEntries(MATERIAL_KEYS.map(k => [k, materials[k] ? { name: materials[k]!.name, size: materials[k]!.size } : null])) as DraftData["materials"];
  return { version: 2, app: "execution-materials-assistant", exportedAt: new Date().toISOString(), state, materials: index };
}
export function parseDraft(text: string): { state: AppState; materials: CaseMaterials; migrated: boolean } {
  if (new TextEncoder().encode(text).length > MAX_DRAFT_BYTES) throw new Error("草稿超过1MB，未导入。");
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("文件不是有效JSON，未改变当前草稿。"); }
  const root = object(json, "草稿");
  if (root.version !== 1 && root.version !== 2) throw new Error("不支持该草稿版本，请使用本工具v1演示或v1.x应用导出的草稿。");
  if (root.version === 2 && root.app !== "execution-materials-assistant") throw new Error("不是本工具的草稿文件。");
  const raw = root.version === 1 ? root : object(root.state, "草稿内容");
  const state = createInitialState();
  const data = object(raw.caseData, "案件字段");
  for (const k of Object.keys(FIELD_LABELS) as (keyof CaseData)[]) state.caseData[k] = string(data[k], FIELD_LABELS[k], k === "requestSummary" || k === "assetClue" ? 4000 : 300);
  if (state.caseData.effectiveDate && !validDate(state.caseData.effectiveDate)) throw new Error("生效日期不存在或超出1900至2100年范围。");
  if (state.caseData.principal) moneyCents(state.caseData.principal);
  const calc = object(raw.calculation, "金额输入");
  state.calculation.mode = root.version === 1 ? "fixed" : calc.mode as "fixed" | "principal";
  if (!["fixed", "principal"].includes(state.calculation.mode)) throw new Error("金额模式不正确。");
  for (const k of ["annualRate", "startDate", "endDate", "basisNote"] as const) state.calculation[k] = string(calc[k], "金额输入", k === "basisNote" ? 2000 : 100);
  for (const k of ["startDate", "endDate"] as const) if (state.calculation[k] && !validDate(state.calculation[k])) throw new Error("试算日期不存在或超出范围。");
  if (state.calculation.annualRate && (!/^(0|[1-9]\d{0,2})(\.\d{1,6})?$/.test(state.calculation.annualRate) || Number(state.calculation.annualRate) > 100)) throw new Error("草稿年利率格式不正确。");
  if (state.calculation.startDate && state.calculation.endDate && state.calculation.startDate > state.calculation.endDate) throw new Error("草稿截止日期早于起算日期。");
  const checks = object(raw.checklist, "材料清单");
  for (const k of Object.keys(CHECKLIST)) {
    if (checks[k] !== undefined && typeof checks[k] !== "boolean") throw new Error("材料清单须为是或否。");
    state.checklist[k] = checks[k] === true;
  }
  const materials = emptyMaterials();
  if (root.version === 2) {
    const scope = object(raw.scopeAnswers, "适用范围");
    for (const k of Object.keys(state.scopeAnswers) as ScopeKey[]) {
      if (scope[k] !== undefined && scope[k] !== null && typeof scope[k] !== "boolean") throw new Error("适用范围答案格式错误。");
      state.scopeAnswers[k] = scope[k] === undefined ? null : scope[k] as boolean | null;
    }
    const reviews = object(raw.reviews ?? {}, "核对记录");
    for (const item of REVIEW_ITEMS) if (reviews[item.key] !== undefined) state.reviews[item.key].note = string(object(reviews[item.key], "核对项").note, "核对依据", 2000);
    const sources = object(raw.sources ?? {}, "字段来源");
    for (const k of Object.keys(FIELD_LABELS) as (keyof CaseData)[]) if (sources[k] !== undefined) state.sources[k] = source(sources[k], k);
    const userEdited = object(raw.userEdited ?? {}, "手工修改标记");
    for (const k of Object.keys(FIELD_LABELS) as (keyof CaseData)[]) {
      if (userEdited[k] !== undefined && typeof userEdited[k] !== "boolean") throw new Error("手工修改标记格式不正确。");
      if (userEdited[k] === true) state.userEdited[k] = true;
    }
    const index = object(root.materials ?? {}, "材料索引");
    for (const k of MATERIAL_KEYS) {
      if (index[k] === undefined || index[k] === null) continue;
      const m = object(index[k], "材料记录");
      const item: MaterialIndex = { name: string(m.name, "文件名"), size: m.size as number };
      if (!item.name || typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 20 * 1024 * 1024) throw new Error("材料文件名或大小不正确。");
      materials[k] = { ...item, file: null, status: "index", message: "仅恢复文件索引，请重新选择原文件；尚未重新读取。", pages: [], candidates: [] };
    }
  }
  // Stored totals and confirmation flags are never a source of authority.
  const complete = state.caseData.principal && (state.calculation.mode === "principal" || (state.calculation.annualRate && state.calculation.startDate && state.calculation.endDate));
  if (complete) state.result = compute(state.caseData.principal, state.calculation);
  return { state, materials, migrated: root.version === 1 };
}

export function downloadBytes(bytes: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
