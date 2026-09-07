import { CHECKLIST, currentResult, MATERIAL_LABELS, outputIssues, REVIEW_ITEMS } from "./domain";
import { makeDraft, MATERIAL_KEYS } from "./drafts";
import type { AppState, CaseMaterials } from "./types";

export type DocumentBlock = { text: string; kind?: "title" | "heading" | "paragraph"; pageBreak?: boolean };
export const TEMPLATE_VERSION = "材料核对草稿-v1.1.1-20260906";
export function applicationBlocks(s: AppState): DocumentBlock[] {
  const d = s.caseData, r = currentResult(s), c = s.calculation;
  const v = (text: string) => text.trim() || "待补充";
  const blocks: DocumentBlock[] = [
    { text: "执行申请书核对草稿", kind: "title" },
    { text: "本文件用于整理材料及人工核对。模板未经法律专业审核，不是法院指定表格，不可直接作为已审核的申请材料提交。请按受理法院要求补齐要素并核定请求。" },
    { text: "当事人信息", kind: "heading" },
    { text: `申请执行人：${v(d.applicantName)}；主体类型：${v(d.applicantType)}。` },
    { text: `证件号码：${v(d.applicantId)}。联系电话：${v(d.applicantPhone)}。` },
    { text: `送达地址：${v(d.applicantAddress)}。` },
    { text: `被执行人：${v(d.respondentName)}；主体类型：${v(d.respondentType)}。` },
    { text: `证件号码：${v(d.respondentId)}。已知地址：${v(d.respondentAddress)}。` },
    { text: "其他当事人要素（如出生日期、法定代表人等）请按身份类型及受理法院模板另行补充。" },
    { text: "执行依据", kind: "heading" },
    { text: `文书作出法院：${v(d.court)}。文书类型：${v(d.basisType)}。案号：${v(d.caseNumber)}。` },
    { text: `申请人填写的生效日期：${v(d.effectiveDate)}。生效、送达与履行期限的证明以原件和法院核实结果为准。` },
    { text: "请求事项", kind: "heading" },
    ...v(d.requestSummary).split("\n").filter(Boolean).map(text => ({ text })),
    { text: `请求本金：人民币${r?.principal ?? v(d.principal)}元。` },
    { text: c.mode === "fixed" ? `核对用试算：利息${r?.interest ?? "待重新计算"}元，本金与试算利息合计${r?.total ?? "待重新计算"}元。该合计不自动等于依法可执行金额。` : "本草稿只整理上述本金。其他利息、迟延履行利息及费用未自动计算；未计算不表示放弃请求。" },
    { text: "事实和理由补充", kind: "heading" },
    { text: "请对照生效法律文书主文补充尚未履行的具体义务、履行期限及届满情况；不要将系统提示直接当作已核实事实。" },
    { text: `已知财产线索：${v(d.assetClue)}。线索尚未经本工具真实性核验。` },
    { text: `此致\n${v(d.executionCourt)}` },
    { text: "申请执行人签名或盖章：________________\n日期：______年____月____日" },
    { text: "金额核对记录", kind: "heading", pageBreak: true },
    { text: `计算模式：${c.mode === "fixed" ? "单本金固定年利率试算" : "仅整理本金"}。版本：${r?.rule ?? "未计算"}。` },
    { text: `金额依据：${v(c.basisNote)}。` },
  ];
  if (c.mode === "fixed") blocks.push(
    { text: `本金${r?.principal ?? "待核对"}元；年利率${v(c.annualRate)}%；起算日${v(c.startDate)}，截止日${v(c.endDate)}，包含首尾共${r?.days ?? "待核对"}天。` },
    { text: "公式：本金 × 年利率 ÷ 100 × 天数 ÷ 365。按十进制整数精确计算，利息最后一次四舍五入到分，合计为本金加舍入后的利息。" },
    { text: `未舍入利息：${r?.exactInterest ?? "待计算"}。` },
    { text: `试算利息：${r?.interest ?? "待核对"}元；合计：${r?.total ?? "待核对"}元。` },
    { text: "仅适用于用户核对的单一本金、固定年利率、无部分履行情形。不自动包含法定迟延履行利息、费用、分段利率或抵扣；首尾日及365天口径须与依据一致。" },
  );
  blocks.push({ text: `计算时间：${r?.calculatedAt ?? "未计算"}；用户金额确认时间：${r?.confirmedAt ?? "未确认"}。` },
    { text: "人工核对与待补材料", kind: "heading" },
    { text: "以下记录由使用者填写，不是系统或法院作出的法律判断；记录确认不等于具备申请执行条件。" });
  for (const item of REVIEW_ITEMS) blocks.push({ text: `${item.label}：${s.reviews[item.key].confirmedAt ? "使用者已记录核对" : "待人工核对"}。依据：${v(s.reviews[item.key].note)}。${s.reviews[item.key].confirmedAt ? `记录时间：${s.reviews[item.key].confirmedAt}。` : ""}` });
  if (s.scopeAnswers.complex) blocks.push({ text: "适用范围第5题为是：涉及的复杂事项需人工处理；本草稿仅用于整理本金和已填请求，未自动计算复杂项目。" });
  blocks.push({ text: `模板版本：${TEMPLATE_VERSION}。签名、日期及各项补充内容请在完整核对后自行填写。` });
  return blocks;
}
export async function buildDocx(s: AppState): Promise<Uint8Array<ArrayBuffer>> {
  const issues = outputIssues(s);
  if (issues.length) throw new Error(issues[0]);
  const { Document, Paragraph, TextRun, Packer, AlignmentType, HeadingLevel } = await import("docx");
  const doc = new Document({
    creator: "执行申请材料助手", title: "执行申请书核对草稿", description: "本地生成，模板未经法律专业审核",
    styles: { default: {
      document: { run: { font: "宋体", size: 24, color: "000000" }, paragraph: { spacing: { after: 110, line: 300 } } },
      title: { run: { font: "黑体", size: 36, bold: true, color: "000000" }, paragraph: { spacing: { after: 260 }, alignment: AlignmentType.CENTER } },
      heading1: { run: { font: "黑体", size: 27, bold: true, color: "000000" }, paragraph: { spacing: { before: 200, after: 140 }, keepNext: true } },
    } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } },
      children: applicationBlocks(s).map(b => new Paragraph({
        heading: b.kind === "title" ? HeadingLevel.TITLE : b.kind === "heading" ? HeadingLevel.HEADING_1 : undefined,
        pageBreakBefore: b.pageBreak, widowControl: true,
        children: b.text.split("\n").map((text, i) => new TextRun({ text, break: i ? 1 : 0 })),
      })),
    }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
export function safeFilename(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "_").slice(0, 160) || "材料";
}
export async function buildPackage(s: AppState, materials: CaseMaterials, includeOriginals: boolean) {
  const docx = await buildDocx(s);
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {
    "01_执行申请书核对草稿.docx": docx,
    "02_本地草稿.json": strToU8(JSON.stringify(makeDraft(s, materials), null, 2)),
    "03_金额核对记录.json": strToU8(JSON.stringify({ input: { principal: s.caseData.principal, ...s.calculation }, result: currentResult(s) }, null, 2)),
    "04_材料清单.txt": strToU8("材料清单仅记录使用者勾选，不证明文件完整、已上传或有效。\n\n" + Object.entries(CHECKLIST).map(([k, label]) => `${s.checklist[k] ? "已勾选" : "未勾选"}  ${label}`).join("\n") + "\n\n本次选择的文件\n" + MATERIAL_KEYS.map(k => `${MATERIAL_LABELS[k]}：${materials[k]?.name ?? "未选择"}${materials[k] ? (materials[k]?.file && includeOriginals ? "（已按选择加入原文件）" : "（未加入原文件）") : ""}`).join("\n")),
    "05_使用说明.txt": strToU8("执行申请材料助手 v1.1.1 核对草稿材料包\n\n不是已审核的法院提交包。申请书模板须经专业人员和受理法院要求核对；不要直接提交带待补充内容的草稿。\nOCR识别、角色匹配及主文请求整理可能存在错误，请逐项对照原件；任何字段均可手工修改。\nJSON及Word含明文案件资料，请妥善保管，勿公开分享。草稿JSON不含原始文件，导入后需重新核对；原文件仅在用户明确勾选时加入。\n请本人在人民法院在线服务网 https://zxfw.court.gov.cn/ 完成认证、上传与提交。工具不进行上述操作。\n"),
  };
  if (includeOriginals) {
    for (const k of MATERIAL_KEYS) {
      const material = materials[k];
      if (material?.file) files[`原始材料/${MATERIAL_LABELS[k]}_${safeFilename(material.name)}`] = new Uint8Array(await material.file.arrayBuffer());
    }
  }
  return zipSync(files, { level: 1 });
}
