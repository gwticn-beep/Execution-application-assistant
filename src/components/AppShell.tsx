import type { ReactNode } from "react";
import type { StepId } from "../types";
import { Icon, type IconName } from "./Icon";

export const steps: Array<{ id: StepId; label: string; icon: IconName }> = [
  { id: 1, label: "适用范围", icon: "shield" },
  { id: 2, label: "案件信息", icon: "user" },
  { id: 3, label: "金额试算", icon: "calculator" },
  { id: 4, label: "文书与材料", icon: "file" },
  { id: 5, label: "官方填报", icon: "list" },
];

type AppShellProps = {
  children: ReactNode;
  currentStep: StepId;
  footerMessage: string;
  onStepChange: (step: StepId) => void;
  statuses: Record<StepId, string>;
  onExportDraft: () => void;
  onImportDraft: (file: File) => void;
  onReset: () => void;
  busy: boolean;
};

export function AppShell({ children, currentStep, footerMessage, onStepChange, statuses, onExportDraft, onImportDraft, onReset, busy }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark"><Icon name="scale" size={24} /></span>
          <span className="brand__copy">
            <strong>执行申请材料助手</strong>
            <span>v1.1 · 本地OCR材料工具</span>
          </span>
        </div>

        <nav aria-label="MVP页面" className="side-nav">
          {steps.map((step) => (
            <button
              aria-current={currentStep === step.id ? "page" : undefined}
              className={`side-nav__item ${currentStep === step.id ? "is-active" : ""}`}
              key={step.id}
              onClick={() => onStepChange(step.id)}
              type="button"
            >
              <Icon name={step.icon} size={18} />
              <span>{step.label}</span>
            </button>
          ))}
        </nav>

        <div className="workspace-actions">
          <button type="button" onClick={onExportDraft}><Icon name="download" size={16} />保存本地草稿</button>
          <label className="file-picker"><Icon name="upload" size={16} />恢复草稿<input type="file" aria-label="恢复本地草稿" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) onImportDraft(file); e.target.value = ""; }} /></label>
          <button type="button" onClick={onReset} disabled={busy}>新建空白案件</button>
        </div>

        <div className="sidebar__notes">
          <div><Icon name="shield" size={17} /><span>仅用于材料准备，不代替法律意见</span></div>
          <div><Icon name="lock" size={17} /><span>案件数据默认仅在当前浏览器处理</span></div>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div>
            <p className="topbar__product">执行申请材料助手</p>
            <p className="topbar__subtitle">普通用户五步准备流程</p>
          </div>
          <span className="demo-label">v1.1 OCR核对草稿工具 · 不代替官方提交</span>
        </header>

        <div className="stepper" aria-label="流程进度">
          {steps.map((step, index) => {
            const isComplete = step.id !== 5 && /^(已|可)/.test(statuses[step.id]);
            const isActive = step.id === currentStep;
            return (
              <div className={`stepper__item ${isActive ? "is-active" : ""} ${isComplete ? "is-complete" : ""}`} key={step.id}>
                <button aria-label={`前往${step.label}`} onClick={() => onStepChange(step.id)} type="button">
                  <span className="stepper__circle">{isComplete ? <Icon name="check" size={15} /> : step.id}</span>
                  <span className="stepper__label">{step.label}<small>{statuses[step.id]}</small></span>
                </button>
                {index < steps.length - 1 ? <span aria-hidden="true" className="stepper__line" /> : null}
              </div>
            );
          })}
        </div>

        <section className="page-stage">{children}</section>

        <footer className="app-footer">
          <span><span className="memory-dot" />{footerMessage}</span>
          <span>状态为用户记录，不代表法院审核</span>
        </footer>
      </main>
    </div>
  );
}
