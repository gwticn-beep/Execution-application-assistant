import type { ScopeAnswers, ScopeKey } from "../types";
import { Button, Notice } from "../components/Ui";
import { Icon } from "../components/Icon";

const questions = [
  { id: "basis", text: "您持有已经生效的民事判决、裁定或调解书吗？", supported: true, blocking: true },
  { id: "money", text: "您的请求是否包含金钱给付？", supported: true, blocking: true },
  { id: "partialPerformed", text: "本案是否在申请执行前部分还款或部分履行？", supported: false, blocking: true },
  { id: "effectiveConfirmed", text: "申请执行前是否已开具生效证明或要求法官在审判系统中对本案点击生效？", supported: true, blocking: true },
  { id: "complex", text: "本案是否涉及仲裁、公证债权文书、涉外文书或非金钱义务？", supported: false, blocking: false },
] as const;

type ScopePageProps = {
  answers: ScopeAnswers;
  onAnswer: (id: ScopeKey, value: boolean) => void;
  onContinue: () => void;
};

export function ScopePage({ answers, onAnswer, onContinue }: ScopePageProps) {
  const unanswered = questions.some((question) => answers[question.id] === null);
  const blockingIssues = questions.filter((question) => question.blocking && answers[question.id] !== null && answers[question.id] !== question.supported);
  const advisoryIssues = questions.filter((question) => !question.blocking && answers[question.id] !== null && answers[question.id] !== question.supported);
  const canContinue = !unanswered && blockingIssues.length === 0;

  return (
    <div className="page page--scope">
      <div className="page-heading">
        <div>
          <h1>先判断本工具是否适合您的情况</h1>
          <p>前四题请主动回答；第5题默认“否”，选择“是”仍可继续整理材料。仅支持一个申请人、一个被执行人。</p>
        </div>
        <span className="page-heading__meta"><Icon name="info" size={17} />约1分钟</span>
      </div>

      <div className="question-list">
        {questions.map((question, index) => (
          <fieldset className="question-row" key={question.id}>
            <legend><span>{index + 1}</span>{question.text}</legend>
            <div className="segmented-choice">
              {[true, false].map((value) => (
                <label className={answers[question.id] === value ? "is-selected" : ""} key={String(value)}>
                  <input
                    checked={answers[question.id] === value}
                    name={question.id}
                    onChange={() => onAnswer(question.id, value)}
                    type="radio"
                  />
                  <span>{value ? "是" : "否"}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {blockingIssues.length > 0 ? (
        <Notice title="当前情况不在本工具自动核算的支持范围内" tone="warning">
          请重点核对：{blockingIssues.map((item) => item.text).join("；")}。建议由律师、法律服务人员或受理法院确认后再继续。
        </Notice>
      ) : unanswered ? (
        <Notice title="还有问题未回答" tone="info">完成全部问题后，系统才会显示是否可以继续。</Notice>
      ) : advisoryIssues.length > 0 ? (
        <Notice title="可以继续，但后续需要人工重点核对" tone="warning">
          第5题选择“是”不会影响进入下一步；可以整理本金及材料，涉及复杂义务时不使用自动计息。
        </Notice>
      ) : (
        <Notice title="可以继续整理材料" tone="success">这些是您的回答，不是系统核实结果。后续仍需要自行确认受理法院、期限、金额及材料要求。</Notice>
      )}

      <Notice title="第4题的“已要求”不等于法院已完成确认" tone="info">本工具只记录回答，不查询审判系统。请在案件页独立核对生效证明、送达情况与相关材料。未满足当前范围仍可保存草稿或浏览后续页面，但不能绕过导出校验。</Notice>
      <div className="page-actions page-actions--end">
        <Button disabled={!canContinue} icon="arrow-right" onClick={onContinue}>继续填写案件信息</Button>
      </div>
    </div>
  );
}
