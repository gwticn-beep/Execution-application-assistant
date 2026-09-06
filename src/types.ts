export type StepId = 1 | 2 | 3 | 4 | 5;
export type ScopeKey = "basis" | "money" | "partialPerformed" | "effectiveConfirmed" | "complex";
export type ScopeAnswers = Record<ScopeKey, boolean | null>;
export type CaseMaterialKey = "firstInstance" | "secondInstance" | "identity";
export type CaseData = {
  basisType: string; court: string; executionCourt: string; caseNumber: string; effectiveDate: string;
  applicantType: string; applicantName: string; applicantId: string; applicantPhone: string; applicantAddress: string;
  respondentType: string; respondentName: string; respondentId: string; respondentAddress: string;
  assetClue: string; principal: string; requestSummary: string;
};
export type CalculationInput = { mode: "principal" | "fixed"; annualRate: string; startDate: string; endDate: string; basisNote: string };
export type CalculationResult = {
  fingerprint: string; principal: string; interest: string; total: string; days: number;
  calculatedAt: string; confirmedAt: string | null; rule: "simple-365-inclusive-v1"; exactInterest: string;
};
export type ReviewKey = "obligation" | "effective" | "performance" | "period" | "identity";
export type Review = { note: string; confirmedAt: string | null };
export type MaterialIndex = { name: string; size: number };
export type Source = { material: CaseMaterialKey; name: string; location: string; quote: string };
export type Candidate = { field: keyof CaseData; value: string; source: Source };
export type TextPage = { location: string; text: string };
export type CaseMaterial = MaterialIndex & {
  file: File | null; status: "idle" | "reading" | "ready" | "error" | "index";
  message: string; pages: TextPage[]; candidates: Candidate[];
};
export type CaseMaterials = Record<CaseMaterialKey, CaseMaterial | null>;
export type CaseAnalysisStatus = "idle" | "parsing" | "complete";
export type AppState = {
  scopeAnswers: ScopeAnswers; caseData: CaseData; calculation: CalculationInput; result: CalculationResult | null;
  checklist: Record<string, boolean>; reviews: Record<ReviewKey, Review>;
  caseConfirmedAt: string | null; outputConfirmedAt: string | null;
  sources: Partial<Record<keyof CaseData, Source>>;
};
export type DraftData = {
  version: 2; app: "execution-materials-assistant"; exportedAt: string; state: AppState;
  materials: Record<CaseMaterialKey, MaterialIndex | null>;
};
export type ToastState = { message: string; tone?: "success" | "info" | "warning" } | null;
