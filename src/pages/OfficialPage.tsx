import { currentResult, outputIssues } from "../domain";
import type { AppState } from "../types";
import { Button, Notice } from "../components/Ui";
import { Icon } from "../components/Icon";
type Props = { state: AppState; onBack: () => void; onCopy: (label: string, value: string) => void; onExportDraft: () => void; onImportDraft: (file: File) => void; busy: boolean };
export function OfficialPage({ state, onBack, onCopy, onExportDraft, onImportDraft, busy }: Props) {
  const d = state.caseData, r = currentResult(state), issues = outputIssues(state);
  const amountReady = !issues.length;
  const rows = [
    ["申请执行人姓名/名称", d.applicantName], ["申请执行人证件号码", d.applicantId], ["申请人联系电话", d.applicantPhone], ["申请人送达地址", d.applicantAddress],
    ["被执行人姓名/名称", d.respondentName], ["被执行人证件号码", d.respondentId], ["执行依据文书类型", d.basisType], ["执行依据文书案号", d.caseNumber],
    ["文书作出法院", d.court], ["拟申请执行法院", d.executionCourt], ["请求事项简述", d.requestSummary],
    ["请求执行本金（元）", amountReady ? r?.principal ?? "" : ""], [state.calculation.mode === "fixed" ? "核对用试算合计（元）" : "本次只整理本金（元）", amountReady ? r?.total ?? "" : ""],
  ];
  return <div className="page"><div className="page-heading"><div><h1>在官方平台填写时，可逐项复制以下内容</h1><p>不会读取法院账号、验证码或Cookie，不控制官方网页，也不会自动提交。</p></div><span className="page-heading__meta">{issues.length ? "尚有内容待核对" : "草稿确认完成 · 未提交"}</span></div>
    {issues.length ? <Notice title="可以查看字段，金额复制暂不可用" tone="warning">请回到前面步骤处理：{issues.join("；")}。</Notice> : null}
    <div className="official-layout"><section className="copy-panel"><div className="panel-heading"><div><Icon name="copy" size={19} /><h2>填报参考内容</h2></div><span>请与法律文书再次核对</span></div><div className="copy-rows">{rows.map(([label, value]) => <div className="copy-row" key={label}><span>{label}</span><strong>{value || (label.includes("元") ? "待核对，暂不可复制" : "未填写")}</strong><button type="button" disabled={!value} onClick={() => onCopy(label, value)} aria-label={`复制${label}`}><Icon name="copy" size={15} />复制</button></div>)}</div><p className="copy-panel__hint">金额未自动包括迟延履行利息或费用；试算合计不能不加区分地填入官方执行标的。复制不会截断完整值。</p></section>
      <aside className="official-side"><section className="official-card official-card--primary"><Icon name="external" size={22} /><div><h2>人民法院在线服务网</h2><p>由您自行登录、实名认证、上传和提交；不附带任何案件参数。</p></div><a className="button button--primary" href="https://zxfw.court.gov.cn/" target="_blank" rel="noopener noreferrer"><span>打开官方网站</span><Icon name="external" size={17} /></a></section>
      <section className="official-card"><h2>本地草稿</h2><p>主动导出明文JSON以便下次恢复。不含原始文件，恢复后需重新核对。</p><div className="draft-actions"><Button icon="download" tone="secondary" onClick={onExportDraft}>导出草稿</Button><label className="file-picker"><Icon name="upload" size={15} />导入草稿<input type="file" aria-label="官方页导入草稿" accept=".json,application/json" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) onImportDraft(f); e.target.value = ""; }} /></label></div></section>
      <section className="official-card privacy-card"><h2>隐私与保存</h2><ul><li>默认只在页面内存中处理，不上传、不同步、不自动持久化。</li><li>刷新或关闭会丢失尚未导出的内容。离开提醒不是保存。</li><li>草稿、材料包和剪贴板可能含敏感信息，请勿公开分享或在共享设备遗留。</li><li>本地处理不等于绝对保密；系统、扩展和用户分享行为仍有影响。</li></ul></section></aside>
    </div><Notice title="正式提交由您完成" tone="warning">请核对受理法院、申请期限、请求金额、签名盖章与附件。当前模板未经专业法律审核，下载草稿不等于已经具备正式申请材料；如需确认，可联系受理法院或12368。</Notice><div className="page-actions"><Button icon="arrow-left" tone="secondary" onClick={onBack}>返回文书与材料</Button></div>
  </div>;
}
