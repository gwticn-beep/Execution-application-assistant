import type { AppState, CalculationInput, CalculationResult, CaseData, ReviewKey, ScopeAnswers, ScopeKey } from "./types";

export const FIELD_LABELS: Record<keyof CaseData, string> = {
  basisType: "执行依据类型", court: "文书作出法院", executionCourt: "拟申请执行法院", caseNumber: "文书案号", effectiveDate: "生效日期",
  applicantType: "申请人类型", applicantName: "申请人姓名或名称", applicantId: "申请人证件号码", applicantPhone: "申请人联系电话", applicantAddress: "申请人送达地址",
  respondentType: "被执行人类型", respondentName: "被执行人姓名或名称", respondentId: "被执行人证件号码", respondentAddress: "被执行人已知地址",
  assetClue: "财产线索", principal: "请求本金", requestSummary: "请求事项简述",
};
export const MATERIAL_LABELS = { firstInstance: "一审文书", secondInstance: "二审文书", identity: "身份证明或主体材料" } as const;
export const CHECKLIST = {
  application: "执行申请书核对草稿", basis: "生效法律文书", effective: "生效证明或相关材料", identity: "申请执行人身份证明",
  service: "送达、生效或履行期限相关材料", asset: "财产线索材料", agent: "授权委托材料", local: "当地法院要求的其他材料",
};
export const REVIEW_ITEMS: { key: ReviewKey; label: string; instruction: string; materials: string }[] = [
  { key: "obligation", label: "裁判文书给付内容确定性", instruction: "对照裁判主文，记录权利人、义务人、给付内容和金额的对应关系；原告不一定是申请执行人。", materials: "生效文书主文及相关页码" },
  { key: "effective", label: "文书生效与送达证明", instruction: "分别核对生效和送达依据。已要求法官操作不等于已完成生效确认；有疑问请向原审法院核实。", materials: "生效证明、送达回证或法院认可的其他材料" },
  { key: "performance", label: "履行期限届满状态", instruction: "记录履行期限条款、起算依据及是否届满。系统不会从生效日自动推定履行期限。", materials: "履行期限条款、送达日期及相关证明" },
  { key: "period", label: "申请执行期限", instruction: "结合履行期限与可能影响期间的事实人工核对；存在争议请联系受理法院或专业人员。系统不自动判断是否超期。", materials: "期限说明及相关事实证明（如有）" },
  { key: "identity", label: "被执行人主体资格有效性", instruction: "核对双方身份、名称和文书的对应关系；号码格式或字段齐全不能证明主体真实有效。", materials: "身份证明、主体信息及与文书对应的资料" },
];
export function createInitialState(): AppState {
  return {
    scopeAnswers: { basis: null, money: null, partialPerformed: null, effectiveConfirmed: null, complex: false },
    caseData: Object.fromEntries(Object.keys(FIELD_LABELS).map(k => [k, ""])) as CaseData,
    calculation: { mode: "principal", annualRate: "", startDate: "", endDate: "", basisNote: "" }, result: null,
    checklist: Object.fromEntries(Object.keys(CHECKLIST).map(k => [k, false])),
    reviews: Object.fromEntries(REVIEW_ITEMS.map(x => [x.key, { note: "", confirmedAt: null }])) as AppState["reviews"],
    caseConfirmedAt: null, outputConfirmedAt: null, sources: {},
  };
}
export function scopeValid(a: ScopeAnswers) {
  return a.basis === true && a.money === true && a.partialPerformed === false && a.effectiveConfirmed === true && a.complex !== null;
}
export function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function moneyCents(s: string): bigint {
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(s.trim())) throw new Error("本金须为非负金额，最多12位整数、2位小数；不能留空或使用科学计数法。");
  const [whole, decimals = ""] = s.trim().split(".");
  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
}
export function centsText(cents: bigint) { return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`; }
export function calculationFingerprint(principal: string, i: CalculationInput) {
  return JSON.stringify([principal, i.mode, i.annualRate, i.startDate, i.endDate, i.basisNote]);
}
export function compute(principal: string, input: CalculationInput, now = new Date().toISOString()): CalculationResult {
  const cents = moneyCents(principal);
  let days = 0, interestCents = 0n, exactInterest = "0 元";
  if (input.mode === "fixed") {
    if (!/^(0|[1-9]\d{0,2})(\.\d{1,6})?$/.test(input.annualRate.trim()) || Number(input.annualRate) > 100) throw new Error("年利率须为0至100之间的百分数，最多6位小数；0和未填写不同。");
    if (!validDate(input.startDate) || !validDate(input.endDate)) throw new Error("请填写有效起止日期（1900年至2100年）。");
    const day = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    days = (day(input.endDate) - day(input.startDate)) / 86400000 + 1;
    if (days <= 0) throw new Error("截止日期不能早于起算日期。");
    if (days > 36525) throw new Error("试算区间不得超过100年，请检查日期。");
    const [w, f = ""] = input.annualRate.trim().split(".");
    const rate = BigInt(w) * 1000000n + BigInt(f.padEnd(6, "0"));
    const numerator = cents * rate * BigInt(days), denominator = 100n * 1000000n * 365n;
    interestCents = (numerator + denominator / 2n) / denominator;
    exactInterest = `${numerator} / ${denominator * 100n} 元（精确分数）`;
  }
  return { fingerprint: calculationFingerprint(principal, input), principal: centsText(cents), interest: centsText(interestCents), total: centsText(cents + interestCents), days, calculatedAt: now, confirmedAt: null, rule: "simple-365-inclusive-v1", exactInterest };
}
export function currentResult(s: AppState) {
  return s.result?.fingerprint === calculationFingerprint(s.caseData.principal, s.calculation) ? s.result : null;
}
export function caseErrors(data: CaseData): Partial<Record<keyof CaseData, string>> {
  const errors: Partial<Record<keyof CaseData, string>> = {};
  const required: (keyof CaseData)[] = ["basisType", "court", "executionCourt", "caseNumber", "effectiveDate", "applicantType", "applicantName", "applicantPhone", "applicantAddress", "respondentType", "respondentName", "principal", "requestSummary"];
  for (const k of required) if (!data[k].trim()) errors[k] = `请填写${FIELD_LABELS[k]}`;
  for (const k of Object.keys(FIELD_LABELS) as (keyof CaseData)[]) if (data[k].length > (k === "requestSummary" || k === "assetClue" ? 4000 : 300)) errors[k] = "内容过长，请精简后填写";
  if (data.effectiveDate && !validDate(data.effectiveDate)) errors.effectiveDate = "请输入真实存在的日期";
  if (data.effectiveDate && data.effectiveDate > new Date().toISOString().slice(0, 10)) errors.effectiveDate = "生效日期不能是未来日期，请核对";
  if (data.applicantPhone && !/^[+\d()（）\-\s]{5,30}$/.test(data.applicantPhone)) errors.applicantPhone = "请输入可联系的电话号码";
  if (data.basisType && !["民事判决书", "民事裁定书", "民事调解书"].includes(data.basisType)) errors.basisType = "请选择本工具支持的文书类型";
  for (const k of ["applicantType", "respondentType"] as const) if (data[k] && !["自然人", "法人或其他组织"].includes(data[k])) errors[k] = "请选择主体类型";
  try { if (moneyCents(data.principal) <= 0n) errors.principal = "请求本金须大于0元"; } catch (e) { errors.principal = (e as Error).message; }
  return errors;
}
export function outputIssues(s: AppState, includeFinal = true): string[] {
  const errors = Object.values(caseErrors(s.caseData)) as string[];
  if (!scopeValid(s.scopeAnswers)) errors.unshift("请主动完成适用范围确认，前四题须符合支持条件");
  if (!s.caseConfirmedAt) errors.push("请在案件页确认当前字段已与材料核对");
  const r = currentResult(s);
  if (!r || !r.confirmedAt) errors.push("请重新核对并确认金额；未计算或旧结果不可导出");
  if (s.calculation.mode === "fixed" && s.scopeAnswers.complex) errors.push("复杂情形不使用自动计息，请切换为只整理本金并人工核对其他请求");
  if (!s.calculation.basisNote.trim()) errors.push("请说明本金或计息口径的材料依据");
  if (includeFinal && !s.outputConfirmedAt) errors.push("请在文书页确认草稿用途及待人工核对事项");
  return [...new Set(errors)];
}
export function invalidateCase(s: AppState): AppState {
  return { ...s, caseConfirmedAt: null, outputConfirmedAt: null, result: s.result ? { ...s.result, confirmedAt: null } : null,
    reviews: Object.fromEntries(REVIEW_ITEMS.map(x => [x.key, { ...s.reviews[x.key], confirmedAt: null }])) as AppState["reviews"] };
}
export function updateCase(s: AppState, key: keyof CaseData, value: string): AppState {
  if (s.caseData[key] === value) return s;
  const sources = { ...s.sources }; delete sources[key];
  return { ...invalidateCase(s), caseData: { ...s.caseData, [key]: value }, sources };
}
export function updateScope(s: AppState, key: ScopeKey, value: boolean): AppState {
  return { ...invalidateCase(s), scopeAnswers: { ...s.scopeAnswers, [key]: value } };
}
