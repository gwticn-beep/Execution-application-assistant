import type { ChangeEvent } from "react";
import { caseErrors, FIELD_LABELS, MATERIAL_LABELS, REVIEW_ITEMS } from "../domain";
import type { AppState, Candidate, CaseAnalysisStatus, CaseData, CaseMaterialKey, CaseMaterials, ReviewKey } from "../types";
import { Button, Field, Input, Notice, SectionHeading, Select, Textarea } from "../components/Ui";
import { Icon } from "../components/Icon";
import { MATERIAL_KEYS } from "../drafts";

type Props = {
  state: AppState; materials: CaseMaterials; analysisStatus: CaseAnalysisStatus;
  onAnalyze: () => void; onMaterialChange: (key: CaseMaterialKey, file: File | null) => void;
  onApplyCandidate: (candidate: Candidate) => void;
  onChange: (field: keyof CaseData, value: string) => void; onConfirm: (v: boolean) => void;
  onReviewChange: (key: ReviewKey, note: string, confirmed: boolean) => void;
  onBack: () => void; onContinue: () => void;
};
const sections: { title: string; hint: string; fields: (keyof CaseData)[] }[] = [
  { title: "执行依据信息", hint: "作出法院与拟申请执行法院分别填写，不自动判断管辖。", fields: ["basisType", "court", "caseNumber", "effectiveDate", "executionCourt"] },
  { title: "申请执行人（您）", hint: "一个申请人。证件号码未知可先留空，导出草稿会明确待补充。", fields: ["applicantType", "applicantName", "applicantId", "applicantPhone", "applicantAddress"] },
  { title: "被执行人（对方）", hint: "一个被执行人。原告、被告与执行中的权利义务人不一定相同，请对照主文。", fields: ["respondentType", "respondentName", "respondentId", "respondentAddress", "assetClue"] },
  { title: "执行请求", hint: "本金在案件、试算、文书与复制页使用同一数值；其他请求请明确写入简述。", fields: ["principal", "requestSummary"] },
];
const optionalFields = ["applicantId", "respondentId", "respondentAddress", "assetClue"];
export function CaseInfoPage({ state, materials, analysisStatus, onAnalyze, onMaterialChange, onApplyCandidate, onChange, onConfirm, onReviewChange, onBack, onContinue }: Props) {
  const errors = caseErrors(state.caseData);
  const missingCount = Object.keys(errors).length;
  const candidates = MATERIAL_KEYS.flatMap(k => materials[k]?.candidates ?? []);
  const bind = (field: keyof CaseData) => ({ value: state.caseData[field], maxLength: ["requestSummary", "assetClue"].includes(field) ? 4000 : 300,
    "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `error-${field}` : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(field, e.target.value),
  });
  return <div className="page">
    <div className="page-heading"><div><h1>请按顺序填写案件信息</h1><p>先读取材料中的文字，或直接手工填写。候选须逐项采纳，最后再确认当前字段。</p></div><span className="page-heading__meta"><Icon name="lock" size={16} />本地读取 · 不上传</span></div>
    <section className="case-import-panel" aria-labelledby="case-import-title">
      <div className="case-import-panel__heading"><div><h2 id="case-import-title">导入案件材料</h2><p>每类1份、每份最多20MB。可读取文本PDF（最多50页）、DOCX正文与UTF-8 TXT。图片及旧DOC只可保留、人工查看，不做OCR。</p></div><span>可选</span></div>
      <div className="case-import-grid">{MATERIAL_KEYS.map(key => {
        const material = materials[key];
        return <div className={`case-import-card ${material ? "has-file" : ""}`} key={key}>
          <span className="case-import-card__icon"><Icon name="file" size={20} /></span>
          <div className="case-import-card__copy"><h3>导入{MATERIAL_LABELS[key]}</h3><p>{key === "secondInstance" ? "有二审时选取；冲突信息保留双方候选" : key === "identity" ? "证件文字请人工核对，本版本不自动识别号码" : "可选判决书、裁定书或调解书"}</p>
            {material ? <><strong className="case-import-card__file">{material.name} · {(material.size / 1024).toFixed(1)} KB</strong><p className={material.status === "error" ? "inline-warning" : ""}>{material.message}</p></> : <span className="case-import-card__empty">尚未选择文件</span>}
          </div>
          <div className="material-buttons"><label className="file-picker"><Icon name="upload" size={15} /><span>{material ? "重新选择" : "选择文件"}</span><input accept=".pdf,.docx,.txt,.doc,.jpg,.jpeg,.png" aria-label={`导入${MATERIAL_LABELS[key]}`} disabled={analysisStatus === "parsing"} type="file" onChange={e => { const file = e.target.files?.[0]; if (file) onMaterialChange(key, file); e.target.value = ""; }} /></label>{material ? <Button tone="ghost" disabled={analysisStatus === "parsing"} onClick={() => onMaterialChange(key, null)} aria-label={`移除${MATERIAL_LABELS[key]}`}>移除</Button> : null}</div>
        </div>;
      })}</div>
      <div className="case-import-panel__actions"><p><Icon name="shield" size={15} />原文件只在内存中；Word的页眉、图片和修订不作为已解析正文。</p><Button icon="file" disabled={analysisStatus === "parsing" || !MATERIAL_KEYS.some(k => materials[k]?.file)} aria-busy={analysisStatus === "parsing"} onClick={onAnalyze}>{analysisStatus === "parsing" ? "正在本地读取…" : "读取文字与候选"}</Button></div>
    </section>
    {MATERIAL_KEYS.some(k => materials[k]?.pages.length) ? <details className="source-panel"><summary>查看已读取的原文及位置（仅当前会话）</summary>{MATERIAL_KEYS.map(k => materials[k]?.pages.length ? <section key={k}><h3>{materials[k]!.name}</h3>{materials[k]!.pages.map((p, i) => <div className="source-text" key={i}><strong>{p.location}</strong><pre>{p.text || "本页未读取到文字，可能需要OCR或人工核对。"}</pre></div>)}</section> : null)}</details> : null}
    {candidates.length ? <section className="candidate-panel"><h2>待采纳的字段候选</h2><p>同字段有不同候选时，请对照一审、二审主文逐项核对。采纳不代表事实已经确认。</p><div className="candidate-list">{candidates.map((c, i) => {
      const conflict = candidates.some(other => other.field === c.field && other.value !== c.value) || Boolean(state.caseData[c.field] && state.caseData[c.field] !== c.value);
      return <article className="candidate-row" key={i}><div><strong>{FIELD_LABELS[c.field]}：{c.value}</strong>{conflict ? <span className="status-chip status-chip--warning">存在不同值</span> : null}<p>{c.source.name} · {c.source.location}</p><blockquote>{c.source.quote}</blockquote></div><Button tone="secondary" onClick={() => onApplyCandidate(c)} aria-label={`采纳${FIELD_LABELS[c.field]}候选${i + 1}`}>采纳此值</Button></article>;
    })}</div></section> : analysisStatus === "complete" ? <Notice title="未发现可直接提议的字段" tone="info">请查看文件读取结果或已读取原文，手工填写。识别不到不会填入演示人名或金额。</Notice> : null}
    <div className="form-sections">{sections.map((section, i) => <section className="form-section" key={section.title}><SectionHeading number={i + 1} description={section.hint}>{section.title}</SectionHeading><div className="form-grid">
      {section.fields.map(field => <Field key={field} label={FIELD_LABELS[field]} required={!optionalFields.includes(field)} hint={state.sources[field] ? `已采纳来源：${state.sources[field]!.name} · ${state.sources[field]!.location}（仍须核对）` : undefined}>
        {field === "basisType" ? <Select {...bind(field)}><option value="">请选择</option>{["民事判决书", "民事裁定书", "民事调解书"].map(v => <option key={v}>{v}</option>)}</Select>
          : field === "applicantType" || field === "respondentType" ? <Select {...bind(field)}><option value="">请选择</option><option>自然人</option><option>法人或其他组织</option></Select>
          : field === "requestSummary" || field === "assetClue" ? <Textarea rows={field === "requestSummary" ? 4 : 2} {...bind(field)} />
          : <Input type={field === "effectiveDate" ? "date" : "text"} inputMode={field === "principal" ? "decimal" : field === "applicantPhone" ? "tel" : "text"} {...bind(field)} />}
        {errors[field] ? <span className="field-error" id={`error-${field}`}>{errors[field]}</span> : null}
      </Field>)}
    </div></section>)}</div>
    <label className="confirmation"><input type="checkbox" checked={Boolean(state.caseConfirmedAt)} disabled={missingCount > 0} onChange={e => onConfirm(e.target.checked)} /><span>我已对照材料核对当前案件字段及拟申请执行法院；未掌握的信息没有自行编造。{state.caseConfirmedAt ? <small>核对时间：{new Date(state.caseConfirmedAt).toLocaleString()}</small> : null}</span></label>
    <div className="case-review-layout"><section className="review-panel"><div className="review-panel__heading"><div><h2>执行立案条件核对</h2><p>五项人工记录 · 不作准入、主体真实性或法院受理判断</p></div></div>
      {REVIEW_ITEMS.map(item => <div className="manual-review" key={item.key}><h3>{item.label}<span className={`status-chip status-chip--${state.reviews[item.key].confirmedAt ? "info" : "warning"}`}>{state.reviews[item.key].confirmedAt ? "已记录核对" : "待人工核对"}</span></h3><p>{item.instruction}</p><Field label={`${item.label}的核对依据`}><Textarea rows={2} maxLength={2000} value={state.reviews[item.key].note} onChange={e => onReviewChange(item.key, e.target.value, false)} placeholder="记下材料名称、页码、已核对事实或尚存问题" /></Field><label className="plain-check"><input type="checkbox" checked={Boolean(state.reviews[item.key].confirmedAt)} disabled={!state.reviews[item.key].note.trim()} onChange={e => onReviewChange(item.key, state.reviews[item.key].note, e.target.checked)} />我已核对并记录上述依据（不等于法院确认）</label></div>)}
    </section><section className="review-panel"><div className="review-panel__heading"><div><h2>缺陷修复与补正提示</h2><p>根据当前缺项及未核对记录更新，不自动补交材料</p></div></div><div className="repair-list">
      {missingCount ? <article className="repair-item"><div><h3>完善案件字段</h3><p>{Object.values(errors).join("；")}。</p></div></article> : null}
      {REVIEW_ITEMS.filter(item => !state.reviews[item.key].confirmedAt).map((item, i) => <article className="repair-item" key={item.key}><span className="repair-item__number">{i + 1}</span><div><h3>{item.label}仍待核对</h3><p>{item.instruction}</p><div><strong>需核对的材料：</strong>{item.materials}</div></div></article>)}
      {REVIEW_ITEMS.every(item => state.reviews[item.key].confirmedAt) ? <p>五项已有人工记录。系统没有核实记录的真实性，也不因此宣告满足执行条件。</p> : null}
    </div></section></div>
    <div className="page-actions"><Button icon="arrow-left" tone="secondary" onClick={onBack}>上一步</Button><div className="page-actions__right">{missingCount ? <span className="inline-warning">还有{missingCount}项需填写或更正</span> : !state.caseConfirmedAt ? <span className="inline-warning">请确认当前案件字段</span> : null}<Button icon="arrow-right" disabled={missingCount > 0 || !state.caseConfirmedAt} onClick={onContinue}>进入金额试算</Button></div></div>
  </div>;
}
