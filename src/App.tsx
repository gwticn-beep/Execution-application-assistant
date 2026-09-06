import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import { Icon } from "./components/Icon";
import { CalculatorPage } from "./pages/CalculatorPage";
import { CaseInfoPage } from "./pages/CaseInfoPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { OfficialPage } from "./pages/OfficialPage";
import { ScopePage } from "./pages/ScopePage";
import { caseErrors, compute, createInitialState, currentResult, FIELD_LABELS, invalidateCase, outputIssues, scopeValid, updateCase, updateScope } from "./domain";
import { downloadBytes, emptyMaterials, makeDraft, MATERIAL_KEYS, MAX_DRAFT_BYTES, parseDraft } from "./drafts";
import { candidatesFromPages, readMaterial, validateFile } from "./extraction";
import { automaticFill } from "./recognition";
import type { AppState, Candidate, CaseAnalysisStatus, CaseMaterialKey, StepId, ToastState } from "./types";

function App() {
  const [step, setStep] = useState<StepId>(1);
  const [state, setState] = useState(createInitialState);
  const [materials, setMaterials] = useState(emptyMaterials);
  const [analysisStatus, setAnalysisStatus] = useState<CaseAnalysisStatus>("idle");
  const [toast, setToast] = useState<ToastState>(null);
  const [dirty, setDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const revision = useRef(0);
  const analysisEpoch = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const showToast = (message: string, tone: NonNullable<ToastState>["tone"] = "info") => setToast({ message, tone });
  const markDirty = () => { revision.current++; setDirty(true); };
  const change = (fn: (s: AppState) => AppState) => { setState(fn); markDirty(); };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => () => { analysisController.current?.abort(); }, []);
  const goTo = (target: StepId) => { setStep(target); window.scrollTo({ top: 0, behavior: "auto" }); };
  const selectMaterial = (key: CaseMaterialKey, file: File | null) => {
    try { if (file) validateFile(file); } catch (e) { showToast((e as Error).message, "warning"); return; }
    analysisEpoch.current++;
    analysisController.current?.abort();
    setMaterials(s => ({ ...s, [key]: file ? { name: file.name, size: file.size, file, status: "idle", message: "已选择，尚未读取", pages: [], candidates: [] } : null }));
    setAnalysisStatus("idle");
    change(invalidateCase);
  };
  const analyze = async () => {
    if (analysisStatus === "parsing") return;
    const selected = MATERIAL_KEYS.filter(k => materials[k]?.file);
    if (!selected.length) { showToast("请先选择材料，或直接手工填写。不会生成模拟解析结果。", "warning"); return; }
    const epoch = ++analysisEpoch.current;
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalysisStatus("parsing");
    let ok = 0;
    const batchCandidates: Candidate[] = [];
    for (const key of selected) {
      if (epoch !== analysisEpoch.current) return;
      const material = materials[key]!;
      setMaterials(s => ({ ...s, [key]: { ...material, status: "reading", message: "正在本地读取…" } }));
      try {
        let lastProgress = 0;
        const pages = await readMaterial(material.file!, { signal: controller.signal, onProgress: progress => {
          if (epoch !== analysisEpoch.current || controller.signal.aborted || Date.now() - lastProgress < 150) return;
          lastProgress = Date.now();
          setMaterials(s => ({ ...s, [key]: { ...material, status: "reading", message: `${progress.message}${progress.progress === undefined ? "" : ` · ${Math.round(progress.progress * 100)}%`}` } }));
        } });
        if (epoch !== analysisEpoch.current) return;
        const candidates = candidatesFromPages(pages, key, material.name);
        batchCandidates.push(...candidates);
        const blank = pages.filter(p => !p.text).length;
        const ocrPages = pages.filter(p => p.method === "ocr").length;
        setMaterials(s => ({ ...s, [key]: { ...material, pages, candidates, status: "ready", message: `${ocrPages ? `OCR完成${ocrPages}页/张` : `已读取${pages.length}个文本位置`}，找到${candidates.length}项字段候选。${blank ? `其中${blank}页未识别到文字，需人工检查。` : "请对照原件核对。"}` } }));
        ok++;
      } catch (e) {
        if (epoch !== analysisEpoch.current) return;
        if (controller.signal.aborted) {
          setMaterials(s => ({ ...s, [key]: { ...material, status: material.pages.length ? "ready" : "idle", message: "已取消本次识别，已有案件信息未被覆盖。" } }));
          setAnalysisStatus("idle"); showToast("已取消识别。本批次结果没有自动填入，您可继续手工修改。", "info"); return;
        }
        setMaterials(s => ({ ...s, [key]: { ...material, pages: [], candidates: [], status: "error", message: (e as Error).message } }));
      }
    }
    if (epoch === analysisEpoch.current) {
      setAnalysisStatus("complete");
      analysisController.current = null;
      if (!controller.signal.aborted) change(s => automaticFill(s, batchCandidates));
      showToast(`识别完成：${ok}/${selected.length}份取得文本。无冲突的可识别信息已填入空白字段；手工修改及主动清空的字段保留，请核对来源。`, ok ? "success" : "warning");
    }
  };
  const applyCandidate = (candidate: Candidate) => {
    const current = state.caseData[candidate.field];
    if (current && current !== candidate.value && !window.confirm(`“${FIELD_LABELS[candidate.field]}”已有填写值。是否用当前候选替换？原有确认将失效。`)) return;
    change(s => ({ ...invalidateCase(updateCase(s, candidate.field, candidate.value)), sources: { ...s.sources, [candidate.field]: candidate.source } }));
    showToast("候选已填入，请核对后确认。其他字段未被覆盖。", "success");
  };
  const calculate = () => {
    try {
      if (!scopeValid(state.scopeAnswers)) throw new Error("请先完成适用范围确认。");
      if (state.scopeAnswers.complex && state.calculation.mode === "fixed") throw new Error("复杂情形不自动计息，请只整理本金并转人工核对。");
      const result = compute(state.caseData.principal, state.calculation);
      change(s => ({ ...s, result, outputConfirmedAt: null }));
      showToast("金额已更新，请核对依据与计算口径后确认。", "success");
    } catch (e) { showToast((e as Error).message, "warning"); }
  };
  const exportDraft = () => {
    downloadBytes(JSON.stringify(makeDraft(state, materials), null, 2), "application/json", "执行申请材料助手-v1.1-本地草稿.json");
    setDirty(false); showToast("已发起草稿下载，请确认文件已保存。明文草稿含案件资料，不含原始文件。", "success");
  };
  const importDraft = async (file: File) => {
    if (importing) return;
    const startRevision = revision.current;
    setImporting(true);
    try {
      if (file.size > MAX_DRAFT_BYTES) throw new Error("草稿不能超过1MB。");
      const next = parseDraft(await file.text());
      if (startRevision !== revision.current) throw new Error("读取期间当前内容已修改，请重新导入以免覆盖新内容。");
      if (!window.confirm("导入将替换当前页面内容。尚未保存的修改会丢失；建议先取消并导出草稿。确定替换吗？")) return;
      analysisEpoch.current++; analysisController.current?.abort(); setState(next.state); setMaterials(next.materials); setAnalysisStatus("idle"); markDirty(); goTo(2);
      showToast(`${next.migrated ? "旧版草稿已迁移，缺少的字段保持空白。" : "草稿已恢复。"}金额已按输入重算，所有确认须重新核对；原文件需重选。`, "success");
    } catch (e) { showToast((e as Error).message, "warning"); } finally { setImporting(false); }
  };
  const download = async (kind: "docx" | "zip", includeOriginals: boolean) => {
    const issues = outputIssues(state);
    if (issues.length) { showToast(issues[0], "warning"); return; }
    if (exporting) return;
    const startRevision = revision.current;
    setExporting(true);
    try {
      const { buildDocx, buildPackage } = await import("./outputs");
      const bytes = kind === "docx" ? await buildDocx(state) : await buildPackage(state, materials, includeOriginals);
      if (startRevision !== revision.current) throw new Error("生成期间内容已改变，本次文件未下载。请重新核对后导出。");
      downloadBytes(new Uint8Array(bytes).buffer, kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/zip", kind === "docx" ? "执行申请书-v1.1-核对草稿.docx" : "执行申请材料-v1.1-核对草稿包.zip");
      showToast("已发起真实文件下载，请在下载目录核对。文件为核对草稿，不能直接作为审核通过的材料提交。", "success");
    } catch (e) { showToast(e instanceof Error ? e.message : "导出失败，当前内容保留。", "warning"); } finally { setExporting(false); }
  };
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); showToast(`“${label}”已复制。`, "success"); }
    catch { showToast("浏览器未允许复制，请手动选择文本复制。", "warning"); }
  };
  const reset = () => {
    if (!window.confirm("新建空白案件会清除当前页面中的字段和材料选择，不会删除下载的草稿。请先确认已保存。继续吗？")) return;
    analysisEpoch.current++; analysisController.current?.abort(); setState(createInitialState()); setMaterials(emptyMaterials()); setAnalysisStatus("idle"); markDirty(); goTo(1);
  };
  const statuses = {
    1: scopeValid(state.scopeAnswers) ? "已回答" : "待回答",
    2: state.caseConfirmedAt ? "已核对字段" : "待核对",
    3: currentResult(state)?.confirmedAt ? "已核对金额" : "待核对",
    4: outputIssues(state).length ? "待核对" : "可导出草稿",
    5: "由本人提交",
  };
  return (
    <AppShell currentStep={step} footerMessage={dirty ? "有未导出的修改 · 关闭前请保存草稿" : "仅页面内存 · 请确认已下载的草稿保管妥当"} onStepChange={goTo} statuses={statuses} onExportDraft={exportDraft} onImportDraft={importDraft} onReset={reset} busy={exporting || importing}>
      {step === 1 ? <ScopePage answers={state.scopeAnswers} onAnswer={(k, v) => change(s => updateScope(s, k, v))} onContinue={() => { if (scopeValid(state.scopeAnswers)) goTo(2); }} /> : null}
      {step === 2 ? <CaseInfoPage state={state} materials={materials} analysisStatus={analysisStatus} onAnalyze={analyze} onCancel={() => analysisController.current?.abort()} onMaterialChange={selectMaterial} onApplyCandidate={applyCandidate}
        onChange={(k, v) => change(s => updateCase(s, k, v))} onConfirm={v => { if (!v || !Object.keys(caseErrors(state.caseData)).length) change(s => ({ ...s, caseConfirmedAt: v ? new Date().toISOString() : null, outputConfirmedAt: null })); }}
        onReviewChange={(key, note, confirmed) => change(s => ({ ...s, outputConfirmedAt: null, reviews: { ...s.reviews, [key]: { note, confirmedAt: confirmed && note.trim() ? new Date().toISOString() : null } } }))}
        onBack={() => goTo(1)} onContinue={() => { if (!Object.keys(caseErrors(state.caseData)).length && state.caseConfirmedAt) goTo(3); }} /> : null}
      {step === 3 ? <CalculatorPage state={state} onBack={() => goTo(2)} onCalculate={calculate} onPrincipalChange={v => change(s => updateCase(s, "principal", v))}
        onChange={(k, v) => change(s => ({ ...s, calculation: { ...s.calculation, [k]: v }, result: null, outputConfirmedAt: null }))}
        onConfirm={v => { if (currentResult(state) && state.calculation.basisNote.trim()) change(s => ({ ...s, result: s.result ? { ...s.result, confirmedAt: v ? new Date().toISOString() : null } : null, outputConfirmedAt: null })); }}
        onContinue={() => goTo(4)} /> : null}
      {step === 4 ? <DocumentsPage state={state} materials={materials} exporting={exporting} onBack={() => goTo(3)} onContinue={() => goTo(5)}
        onChecklistChange={(key, value) => change(s => ({ ...s, checklist: { ...s.checklist, [key]: value }, outputConfirmedAt: null }))}
        onConfirm={v => { if (!v || !outputIssues(state, false).length) change(s => ({ ...s, outputConfirmedAt: v ? new Date().toISOString() : null })); }} onDownload={download} /> : null}
      {step === 5 ? <OfficialPage state={state} onBack={() => goTo(4)} onCopy={copy} onExportDraft={exportDraft} onImportDraft={importDraft} busy={importing} /> : null}
      {toast ? <div className={`toast toast--${toast.tone ?? "info"}`} role={toast.tone === "warning" ? "alert" : "status"}><Icon name={toast.tone === "warning" ? "alert" : toast.tone === "success" ? "check" : "info"} size={18} /><span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}>×</button></div> : null}
    </AppShell>
  );
}
export default App;
