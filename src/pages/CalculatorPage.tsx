import { currentResult, scopeValid } from "../domain";
import type { AppState, CalculationInput } from "../types";
import { Button, Field, Input, Notice, Select, Textarea } from "../components/Ui";
import { Icon } from "../components/Icon";
type Props = {
  state: AppState; onBack: () => void; onCalculate: () => void;
  onChange: (field: keyof CalculationInput, value: string) => void;
  onPrincipalChange: (value: string) => void; onConfirm: (v: boolean) => void; onContinue: () => void;
};
const money = (v: string) => { const [whole, decimals = "00"] = v.split("."); return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimals}`; };
export function CalculatorPage({ state, onBack, onCalculate, onChange, onPrincipalChange, onConfirm, onContinue }: Props) {
  const c = state.calculation, result = currentResult(state);
  const fixed = c.mode === "fixed";
  const blocked = !scopeValid(state.scopeAnswers) || (fixed && state.scopeAnswers.complex === true);
  const bind = (k: "annualRate" | "startDate" | "endDate") => ({ value: c[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(k, e.target.value) });
  return <div className="page">
    <div className="page-heading"><div><h1>限定场景金额试算</h1><p>本金与案件信息同步。计算不会自动推定利率、起止日或可执行金额。</p></div><span className="page-heading__meta page-heading__meta--blue">十进制精确计算</span></div>
    <Notice title={result ? (result.confirmedAt ? "当前金额已由您核对" : "当前计算尚待确认") : "尚无有效结果，填写或修改后请重新核算"} tone={result?.confirmedAt ? "success" : "info"}>每次修改输入或上游事实，文书和复制页都会要求重新核对，不沿用旧的确认。</Notice>
    <div className="calculator-layout"><section className="input-panel"><h2>输入条件</h2><div className="calculator-fields">
      <Field label="金额整理方式"><Select value={c.mode} onChange={e => onChange("mode", e.target.value)}><option value="principal">只整理本金，不计入自动利息</option><option value="fixed">单本金固定年利率试算</option></Select></Field>
      <Field label="本金金额（元）" required hint="修改会同步案件页，并使案件字段确认失效"><Input value={state.caseData.principal} inputMode="decimal" maxLength={16} onChange={e => onPrincipalChange(e.target.value)} /></Field>
      {fixed ? <><Field label="年利率（%）" required hint="无默认利率；最多6位小数，0与未填写不同"><Input inputMode="decimal" maxLength={10} {...bind("annualRate")} /></Field><Field label="起算日期" required><Input type="date" {...bind("startDate")} /></Field><Field label="截止日期" required><Input type="date" {...bind("endDate")} /></Field></> : null}
      <Field label="金额与口径依据" required hint={fixed ? "填写对应文书、条款或页码，确认利率、日期及首尾日口径" : "写明本金对应文书或条款；其他金额项目请人工另核"}><Textarea rows={3} maxLength={2000} value={c.basisNote} onChange={e => onChange("basisNote", e.target.value)} /></Field>
    </div><Button icon="calculator" disabled={blocked} onClick={onCalculate}>{fixed ? "重新试算" : "核算本金"}</Button></section>
      <section className="result-panel" aria-live="polite"><div className="result-panel__header"><div><Icon name="calculator" size={20} /><h2>本次核算结果</h2></div><span>{result?.confirmedAt ? "用户已确认" : "未确认"}</span></div>
        {result ? <><dl className="result-list"><div><dt>本金</dt><dd>¥{money(result.principal)}</dd></div><div><dt>{fixed ? "试算利息" : "自动利息"}</dt><dd>{fixed ? `¥${money(result.interest)}` : "未计算"}</dd></div><div className="result-list__total"><dt>{fixed ? "核对用合计" : "本金"}</dt><dd>¥{money(result.total)}</dd></div>{fixed ? <div><dt>含首尾日</dt><dd>{result.days}天</dd></div> : null}</dl><p>计算时间：{new Date(result.calculatedAt).toLocaleString()}</p><p>未自动计入的利息或费用不代表放弃请求。</p></> : <div className="repair-empty"><Icon name="calculator" size={32} /><strong>等待重新核算</strong><p>文书不会显示或使用过期合计。</p></div>}
      </section>
    </div>
    {fixed ? <section className="formula-panel"><h2>计算方式说明</h2><p>利息 = 本金 × 年利率 ÷ 100 × 天数 ÷ 365；天数按日历日期计算，包含首尾两天。</p><p>本金最多2位小数。使用整数与精确分数计算，仅在最后将利息四舍五入到分；合计为本金加舍入后的利息。</p>{result ? <details><summary>查看精确记录与版本</summary><p className="wrap-anywhere">{result.exactInterest}</p><p>规则版本：{result.rule}</p></details> : null}</section> : null}
    {blocked ? <Notice title="当前条件不能自动核算" tone="warning">请先完成适用范围确认。第5题为“是”仍可整理材料，但不能自动计算复杂项目；请切换只整理本金，并人工核对其他请求。</Notice> : null}
    <label className="confirmation"><input type="checkbox" checked={Boolean(result?.confirmedAt)} disabled={!result || !c.basisNote.trim() || blocked} onChange={e => onConfirm(e.target.checked)} /><span>{fixed ? "我已核对单本金、固定年利率、无部分履行的事实，并确认利率、起止日、含首尾和365天口径与依据一致。" : "我已核对本金与材料一致；本次只整理本金，未将其他利息或费用默认为0。"}</span></label>
    <Notice title="复杂情形请转人工处理" tone="warning">部分还款、抵销、分期、多债权、多被执行人责任比例、分段利率或日期争议不使用本试算。法定迟延履行利息未自动计算。</Notice>
    <div className="page-actions"><Button icon="arrow-left" tone="secondary" onClick={onBack}>返回案件信息</Button><Button icon="arrow-right" disabled={!result?.confirmedAt || blocked} onClick={onContinue}>进入文书与材料</Button></div>
  </div>;
}
