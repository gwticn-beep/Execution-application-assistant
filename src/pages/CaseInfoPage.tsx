import type { ChangeEvent } from "react";
import { caseErrors, FIELD_LABELS, MATERIAL_LABELS, REVIEW_ITEMS } from "../domain";
import type { AppState, Candidate, CaseAnalysisStatus, CaseData, CaseMaterialKey, CaseMaterials, IdentityTarget, ReviewKey } from "../types";
import { Button, Field, Input, Notice, SectionHeading, Select, Textarea } from "../components/Ui";
import { Icon } from "../components/Icon";
import { MATERIAL_KEYS } from "../drafts";
import { sameFieldValue } from "../recognition";

type Props = {
  state: AppState; materials: CaseMaterials; analysisStatus: CaseAnalysisStatus;
  analysisNotices: string[]; identityTarget: IdentityTarget; onIdentityTargetChange: (value: IdentityTarget) => void;
  onAnalyze: () => void; onMaterialChange: (key: CaseMaterialKey, file: File | null) => void;
  onCancel: () => void;
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
export function CaseInfoPage({ state, materials, analysisStatus, analysisNotices, identityTarget, onIdentityTargetChange, onAnalyze, onCancel, onMaterialChange, onApplyCandidate, onChange, onConfirm, onReviewChange, onBack, onContinue }: Props) {
  const errors = caseErrors(state.caseData);
  const missingCount = Object.keys(errors).length;
  const candidates = MATERIAL_KEYS.flatMap(k => materials[k]?.candidates ?? []);
  const autoFields = (Object.keys(state.sources) as (keyof CaseData)[]).filter(field => !state.userEdited[field] && state.caseData[field] === state.sources[field]?.value);
  const bind = (field: keyof CaseData) => ({ id: `case-${field}`, "aria-label": FIELD_LABELS[field], value: state.caseData[field], maxLength: ["requestSummary", "assetClue"].includes(field) ? 4000 : 300,
    "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `error-${field}` : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(field, e.target.value),
  });
  return <div className="page">
    <div className="page-heading"><div><h1>请按顺序填写案件信息</h1><p>OCR识别后自动填入可确定的空白字段；您始终可以修改。核对原件后，再确认案件信息。</p></div><span className="page-heading__meta"><Icon name="lock" size={16} />本地OCR · 不上传</span></div>
    <section className="case-import-panel" aria-labelledby="case-import-title">
      <div className="case-import-panel__heading"><div><h2 id="case-import-title">导入案件材料</h2><p>每类1份、每份最多20MB。PDF逐页OCR（最多50页），支持JPG、PNG、WebP、BMP和多页TIFF；DOCX、TXT读取正文。简体中文及英文识别，文件不上传。</p></div><span>可选</span></div>
      <div className="case-import-grid">{MATERIAL_KEYS.map(key => {
        const material = materials[key];
        return <div className={`case-import-card ${material ? "has-file" : ""}`} key={key}>
          <span className="case-import-card__icon"><Icon name="file" size={20} /></span>
          <div className="case-import-card__copy"><h3>导入{MATERIAL_LABELS[key]}</h3><p>{key === "secondInstance" ? "有二审时选取；改判或对应不明时需人工核对" : key === "identity" ? "按姓名／名称与文书执行角色匹配；也可指定归属" : "识别当事人段落及主文中的收付款关系"}</p>
            {key === "identity" ? <label className="identity-target">身份证明归属<Select aria-label="身份证明归属" value={identityTarget} disabled={analysisStatus === "parsing"} onChange={event => onIdentityTargetChange(event.target.value as IdentityTarget)}><option value="auto">自动按姓名／名称匹配</option><option value="applicant">申请执行人</option><option value="respondent">被执行人</option></Select><small>改变归属后请重新识别；姓名不符或含多个主体时不会强行填入。</small></label> : null}
            {material ? <><strong className="case-import-card__file">{material.name} · {(material.size / 1024).toFixed(1)} KB</strong><p role="status" className={material.status === "error" ? "inline-warning" : ""}>{material.message}</p></> : <span className="case-import-card__empty">尚未选择文件</span>}
          </div>
          <div className="material-buttons"><label className="file-picker"><Icon name="upload" size={15} /><span>{material ? "重新选择" : "选择文件"}</span><input accept=".pdf,.docx,.txt,.doc,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff" aria-label={`导入${MATERIAL_LABELS[key]}`} disabled={analysisStatus === "parsing"} type="file" onChange={e => { const file = e.target.files?.[0]; if (file) onMaterialChange(key, file); e.target.value = ""; }} /></label>{material ? <Button tone="ghost" disabled={analysisStatus === "parsing"} onClick={() => onMaterialChange(key, null)} aria-label={`移除${MATERIAL_LABELS[key]}`}>移除</Button> : null}</div>
        </div>;
      })}</div>
      <div className="case-import-panel__actions"><p><Icon name="shield" size={15} />首次OCR需加载网站提供的程序与模型。原件和识别结果只在本机处理；Word内嵌图片请另存或转PDF。</p><div className="material-buttons">{analysisStatus === "parsing" ? <Button tone="secondary" onClick={onCancel}>取消识别</Button> : null}<Button icon="file" disabled={analysisStatus === "parsing" || !MATERIAL_KEYS.some(k => materials[k]?.file)} aria-busy={analysisStatus === "parsing"} onClick={onAnalyze}>{analysisStatus === "parsing" ? "正在本地识别…" : "OCR识别并自动填入"}</Button></div></div>
    </section>
    {autoFields.length ? <Notice title={`已自动填入${autoFields.length}项，仍待您核对`} tone="info">{autoFields.map(field => FIELD_LABELS[field]).join("、")}。可直接编辑或清空，修改后不会被重复识别覆盖。OCR不是法律审查。</Notice> : null}
    {analysisNotices.length ? <Notice title="字段匹配提示" tone="info"><ul>{analysisNotices.map(message => <li key={message}>{message}</li>)}</ul></Notice> : null}
    {MATERIAL_KEYS.some(k => materials[k]?.pages.length) ? <details className="source-panel"><summary>查看识别文字及来源位置（仅当前会话）</summary>{MATERIAL_KEYS.map(k => materials[k]?.pages.length ? <section key={k}><h3>{materials[k]!.name}</h3>{materials[k]!.pages.map((p, i) => <div className="source-text" key={i}><strong>{p.location}{p.method === "ocr" ? ` · OCR参考分数${Math.round(p.confidence ?? 0)}/100` : ""}</strong><pre>{p.text || "本页未识别到文字，请对照原件人工核对。"}</pre></div>)}</section> : null)}</details> : null}
    {candidates.length ? <section className="candidate-panel"><h2>识别字段与核对来源</h2><p>按裁判主文明示的收付款关系匹配执行角色，按姓名／名称关联身份证明；不把原告、被告直接等同于执行角色。不确定或冲突时留待核对，不自动判断管辖，参考分数不等于准确率。</p><div className="candidate-list">{candidates.map((c, i) => {
      const conflict = candidates.some(other => other.field === c.field && !sameFieldValue(c.field, other.value, c.value)) || Boolean(state.caseData[c.field] && !sameFieldValue(c.field, state.caseData[c.field], c.value));
      return <article className="candidate-row" key={i}><div><strong>{FIELD_LABELS[c.field]}：{c.value}</strong>{conflict ? <span className="status-chip status-chip--warning">存在不同值</span> : null}{state.caseData[c.field] === c.value ? <span className="status-chip status-chip--info">已填入 · 待核对</span> : null}<p>{c.source.name} · {c.source.location}{c.source.method === "ocr" ? ` · 参考分数${Math.round(c.source.confidence ?? 0)}/100` : ""}</p>{c.reason ? <p className={c.autoFill === false ? "inline-warning" : ""}>{c.reason}</p> : null}<blockquote>{c.source.quote}</blockquote></div><Button tone="secondary" disabled={analysisStatus === "parsing"} onClick={() => onApplyCandidate(c)} aria-label={`采纳${FIELD_LABELS[c.field]}候选${i + 1}`}>采纳此值</Button></article>;
    })}</div></section> : analysisStatus === "complete" ? <Notice title="未发现可直接提议的字段" tone="info">请查看文件读取结果或已读取原文，手工填写。识别不到不会填入演示人名或金额。</Notice> : null}
    <div className="form-sections">{sections.map((section, i) => <section className="form-section" key={section.title}><SectionHeading number={i + 1} description={section.hint}>{section.title}</SectionHeading><div className="form-grid">
      {section.fields.map(field => <Field key={field} label={FIELD_LABELS[field]} required={!optionalFields.includes(field)} hint={state.sources[field] ? `${state.userEdited[field] ? "已由您修改或采纳" : "自动填入，待核对"}；识别来源：${state.sources[field]!.name} · ${state.sources[field]!.location}${state.sources[field]!.value && state.sources[field]!.value !== state.caseData[field] ? `；原识别值：${state.sources[field]!.value}` : ""}` : state.userEdited[field] ? "您已手工编辑，重复识别不会覆盖（包括主动清空）。" : undefined}>
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
