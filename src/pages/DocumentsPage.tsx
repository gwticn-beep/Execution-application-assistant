import { useState } from "react";
import { CHECKLIST, outputIssues, REVIEW_ITEMS } from "../domain";
import { MATERIAL_KEYS } from "../drafts";
import { applicationBlocks } from "../outputs";
import type { AppState, CaseMaterials } from "../types";
import { Button, Notice } from "../components/Ui";
import { Icon } from "../components/Icon";
type Props = {
  state: AppState; materials: CaseMaterials; exporting: boolean;
  onBack: () => void; onContinue: () => void;
  onChecklistChange: (key: string, value: boolean) => void; onConfirm: (v: boolean) => void;
  onDownload: (kind: "docx" | "zip", includeOriginals: boolean) => void;
};
export function DocumentsPage({ state, materials, exporting, onBack, onContinue, onChecklistChange, onConfirm, onDownload }: Props) {
  const [fullPreview, setFullPreview] = useState(false);
  const [includeOriginals, setIncludeOriginals] = useState(false);
  const issues = outputIssues(state);
  const blocks = applicationBlocks(state);
  const visible = fullPreview ? blocks : blocks.slice(0, blocks.findIndex(x => x.pageBreak));
  const remainingReviews = REVIEW_ITEMS.filter(i => !state.reviews[i.key].confirmedAt);
  const actualFiles = MATERIAL_KEYS.filter(k => materials[k]?.file);
  const indexesOnly = MATERIAL_KEYS.filter(k => materials[k] && !materials[k]?.file);
  return <div className="page">
    <div className="page-heading"><div><h1>核对申请书和最小材料清单</h1><p>下载的是可编辑的真实Word文件，内容仅为核对草稿；模板尚未经法律专业审核。</p></div><span className="page-heading__meta">已勾选 {Object.values(state.checklist).filter(Boolean).length}/8</span></div>
    {issues.length ? <Notice title={`导出前还有${issues.length}项需要处理`} tone="warning"><ul>{issues.map(x => <li key={x}>{x}</li>)}</ul></Notice> : <Notice title="可以导出核对草稿" tone="success">字段和金额确认已完成。这不等于材料齐全、法律条件满足或法院受理。</Notice>}
    <div className="documents-layout"><section className="document-panel"><div className="panel-heading"><div><Icon name="file" size={19} /><h2>执行申请书核对草稿</h2></div><span>预览与Word共用同一内容</span></div><article className="paper-preview">
      {visible.map((b, i) => b.kind === "title" ? <h3 key={i}>{b.text}</h3> : b.kind === "heading" ? <h4 key={i}>{b.text}</h4> : <p key={i} className="preserve-lines">{b.text}</p>)}
    </article><div className="document-actions"><Button tone="secondary" icon="file" onClick={() => setFullPreview(v => !v)}>{fullPreview ? "收起核对附录" : "预览完整草稿及附录"}</Button><Button icon="download" disabled={Boolean(issues.length) || exporting} aria-busy={exporting} onClick={() => onDownload("docx", false)}>{exporting ? "正在生成…" : "下载Word核对草稿"}</Button></div></section>
    <section className="checklist-panel"><div className="panel-heading"><div><Icon name="list" size={19} /><h2>材料清单</h2></div><span>固定参考清单</span></div>{[{ title: "通常需要", keys: ["application", "basis", "effective", "identity"] }, { title: "按情况需要", keys: ["service", "asset", "agent"] }, { title: "向受理法院确认", keys: ["local"] }].map(group => <div className="checklist-group" key={group.title}><h3>{group.title}</h3>{group.keys.map(k => <label className="check-row" key={k}><input type="checkbox" checked={state.checklist[k]} onChange={e => onChecklistChange(k, e.target.checked)} /><span className="check-row__box"><Icon name="check" size={14} /></span><span>{CHECKLIST[k as keyof typeof CHECKLIST]}</span></label>)}</div>)}
    <div className="package-box"><h3>下载核对草稿材料包</h3><p>包含Word草稿、本地JSON、金额记录、清单和使用说明。不是法院已验收的提交包。</p><label className="plain-check"><input type="checkbox" checked={includeOriginals} onChange={e => setIncludeOriginals(e.target.checked)} />同时加入当前选定的{actualFiles.length}份原文件（可能含敏感信息）</label>{includeOriginals ? <ul>{actualFiles.map(k => <li key={k}>{materials[k]!.name}</li>)}</ul> : null}{indexesOnly.length ? <p className="inline-warning">{indexesOnly.length}份仅恢复了索引，没有原文件，不会加入ZIP。请回案件页重新选择。</p> : null}<Button icon="download" disabled={Boolean(issues.length) || exporting} onClick={() => onDownload("zip", includeOriginals)}>下载ZIP材料包</Button></div>
    </section></div>
    <Notice title="尚需人工核对的事项会随草稿列出" tone="info">{remainingReviews.length ? remainingReviews.map(x => x.label).join("、") : "五项已有用户核对记录，但真实性仍未经系统核验。"}。{!state.caseData.applicantId || !state.caseData.respondentId || !state.caseData.respondentAddress ? "尚未填写的证件号码或地址将在文书中标为待补充。" : ""}未勾选不等于法院一定退回，勾选不等于已上传或证明有效。</Notice>
    <label className="confirmation"><input type="checkbox" checked={Boolean(state.outputConfirmedAt)} disabled={outputIssues(state, false).length > 0} onChange={e => onConfirm(e.target.checked)} /><span>我已核对预览、金额和拟申请执行法院，知道本文件只是核对草稿；上述待补信息、人工记录、模板及签名盖章仍须按受理法院要求处理。</span></label>
    <div className="page-actions"><Button icon="arrow-left" tone="secondary" onClick={onBack}>上一步</Button><Button icon="arrow-right" onClick={onContinue}>进入官方填报复制页</Button></div>
  </div>;
}
