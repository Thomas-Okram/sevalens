export type Role = 'STATE_ADMIN' | 'DISTRICT_OFFICER';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  districtId: number | null;
  districtName: string | null;
}

/** low = green, medium = amber, high = red (always shown with a label/icon). */
export type Severity = 'low' | 'medium' | 'high';

export interface DataStamp {
  dataAsOf: string;
  computedAt: string;
  synthetic: true;
}

export interface SchemeInfo {
  id: number;
  code: string;
  name: string;
  shortName: string;
  category: string;
  eligibilityText: string;
  eligibleBasis: string;
  eligibleFactor: number;
  slaDays: number;
  benefitAmount: number;
  frequency: string;
}

export interface CoverageCell {
  schemeId: number;
  schemeCode: string;
  schemeName: string;
  eligible: number;
  enrolled: number;
  coverage: number; // 0..1
  gap: number; // eligible - enrolled (>= 0)
}

export interface CoverageSummary {
  eligible: number;
  enrolled: number;
  coverage: number;
  gap: number;
  bySchemes: CoverageCell[];
}

export type AttentionFactorKey = 'coverageGap' | 'slaBreach' | 'anomalies' | 'disbursementFailure' | 'remoteness';

export interface FactorContribution {
  key: AttentionFactorKey;
  label: string;
  raw: number;
  rawLabel: string;
  normalized: number; // 0..1
  weight: number; // 0..1, sums to 1
  points: number; // contribution to the 0..100 score
  explanation: string;
}

export interface AttentionScore {
  entityType: 'district' | 'block';
  entityId: number;
  name: string;
  districtId: number;
  districtName: string;
  score: number; // 0..100
  level: Severity;
  factors: FactorContribution[];
  topReason: string;
}

export interface AgeBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
}

export interface StageCount {
  stage: string;
  label: string;
  count: number;
  breached: number;
}

export interface PendencySummary {
  open: number;
  breached: number;
  breachPct: number; // 0..1
  medianAgeDays: number;
  buckets: AgeBucket[];
  stages: StageCount[];
  trend: {
    openNow: number;
    open90DaysAgo: number;
    breachedNow: number;
    breached90DaysAgo: number;
    received90: number;
    receivedPrev90: number;
  };
}

export type AnomalyType =
  | 'duplicate_beneficiary'
  | 'deceased_paid'
  | 'application_spike'
  | 'rejection_spike'
  | 'disbursement_failure_spike'
  | 'officer_outlier'
  | 'pendency_backlog';

export type ReviewStatus = 'open' | 'reviewed' | 'false_positive';

export interface AnomalyReview {
  status: ReviewStatus;
  note: string | null;
  by: string | null;
  at: string | null;
}

export interface Anomaly {
  key: string;
  type: AnomalyType;
  typeLabel: string;
  severity: Severity;
  districtId: number;
  districtName: string;
  blockId: number | null;
  blockName: string | null;
  entityLabel: string;
  metric: string;
  expected: string;
  observed: string;
  reason: string;
  method: string;
  count: number;
  amountAtRisk: number | null;
  score: number | null; // e.g. robust z
  review: AnomalyReview;
}

export interface DistrictSummary {
  id: number;
  code: string;
  name: string;
  lat: number;
  lng: number;
  population: number;
  remoteness: number;
  coverage: CoverageSummary;
  openApplications: number;
  breached: number;
  breachPct: number;
  failureRate: number; // last 3 months, failed+returned / all
  anomalyCount: number;
  attention: AttentionScore;
}

export interface BlockSummary {
  id: number;
  districtId: number;
  name: string;
  lat: number;
  lng: number;
  population: number;
  remoteness: number;
  coverage: CoverageSummary;
  openApplications: number;
  breached: number;
  breachPct: number;
  failureRate: number;
  anomalyCount: number;
  attention: AttentionScore;
}

export interface Kpis {
  eligible: number;
  enrolled: number;
  coverage: number;
  gap: number;
  openApplications: number;
  breached: number;
  breachPct: number;
  activeAnomalies: number;
  highAnomalies: number;
  failureRate: number;
}

export interface Overview extends DataStamp {
  kpis: Kpis;
  districts: DistrictSummary[];
  attention: AttentionScore[]; // districts + blocks ranked
  weights: Record<AttentionFactorKey, number>;
}

export interface MonthlyPoint {
  month: string;
  received: number;
  approved: number;
  rejected: number;
  disbursed: number;
  failed: number;
  failureRate: number;
}

export interface DistrictDetail extends DataStamp {
  district: DistrictSummary;
  blocks: BlockSummary[];
  pendency: PendencySummary;
  pendencyByBlock: { blockId: number; blockName: string; buckets: AgeBucket[]; open: number; breached: number }[];
  monthly: MonthlyPoint[];
  anomalies: Anomaly[];
}

export interface PendingApplication {
  id: number;
  refNo: string;
  applicantMasked: string;
  schemeCode: string;
  schemeName: string;
  districtId: number;
  districtName: string;
  blockId: number;
  blockName: string;
  submittedAt: string;
  ageDays: number;
  slaDays: number;
  breached: boolean;
  status: string;
  stage: string;
  stageLabel: string;
}

export interface PendencyResponse extends DataStamp {
  summary: PendencySummary;
  heatmap: { blockId: number; blockName: string; districtName: string; buckets: number[]; open: number; breached: number }[];
  bucketLabels: string[];
  items: PendingApplication[];
  total: number;
}

export interface AnomalyRecord {
  [key: string]: string | number | null;
}

export interface AnomalyDetail {
  anomaly: Anomaly;
  columns: { key: string; label: string }[];
  records: AnomalyRecord[];
}

export interface AnomaliesResponse extends DataStamp {
  anomalies: Anomaly[];
}

export interface BriefSection {
  heading: string;
  bullets: string[];
}

export interface Brief {
  districtId: number;
  districtName: string;
  title: string;
  situation: string;
  topIssues: { title: string; detail: string }[];
  actions: string[];
  visitFirst: { blockName: string; reason: string };
  factorsUsed: string[];
  source: 'llm' | 'template';
  model: string | null;
  dataAsOf: string;
  generatedAt: string;
  fallbackReason?: string;
}

export type AskIntent =
  | 'pending_by_block'
  | 'coverage_gap'
  | 'attention_ranking'
  | 'anomalies_list'
  | 'disbursement_failures'
  | 'sla_breach_by_scheme';

export interface AskResult {
  question: string;
  intent: AskIntent;
  intentLabel: string;
  filters: Record<string, string | number | null>;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  answer: string;
  source: 'llm' | 'keyword';
  model: string | null;
  dataAsOf: string;
  fallbackReason?: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  userEmail: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: string | null;
  ip: string | null;
}

export interface BeneficiaryView {
  id: number;
  name: string;
  aadhaarMasked: string;
  gender: string;
  dob: string;
  age: number;
  districtName: string;
  blockName: string;
  village: string;
  schemeCode: string;
  schemeName: string;
  status: string;
  enrolledAt: string;
  deceasedAt: string | null;
  payments: { month: string; amount: number; status: string; paidAt: string }[];
}
