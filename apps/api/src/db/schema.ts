/**
 * SevaLens database schema (Drizzle ORM, SQLite dialect).
 *
 * Portability note: only portable column types are used (integer, real, text).
 * Dates are ISO-8601 strings, JSON is stored as text. Swapping to Postgres is a
 * matter of changing `sqlite-core` -> `pg-core` imports and the driver in client.ts.
 */
import { sqliteTable, integer, real, text, index } from 'drizzle-orm/sqlite-core';

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const districts = sqliteTable('districts', {
  id: integer('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  hqLat: real('hq_lat').notNull(),
  hqLng: real('hq_lng').notNull(),
  // Census-2011-based estimates (see seed file). Not official figures.
  population: integer('population').notNull(),
  pctElderly: real('pct_elderly').notNull(),
  pctWidows: real('pct_widows').notNull(),
  pctPwd: real('pct_pwd').notNull(),
  pctRural: real('pct_rural').notNull(),
  remoteness: real('remoteness').notNull(), // 0 (accessible) .. 1 (remote / difficult terrain)
});

export const blocks = sqliteTable(
  'blocks',
  {
    id: integer('id').primaryKey(),
    districtId: integer('district_id').notNull().references(() => districts.id),
    name: text('name').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    popShare: real('pop_share').notNull(), // share of district population
    remoteness: real('remoteness').notNull(),
  },
  (t) => [index('blocks_district_idx').on(t.districtId)],
);

export const schemes = sqliteTable('schemes', {
  id: integer('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  category: text('category').notNull(), // pension | maternity | education
  // Eligibility rule fields (used for display + estimating eligible population)
  minAge: integer('min_age'),
  maxAge: integer('max_age'),
  gender: text('gender'), // F | M | null
  requiresPwd: integer('requires_pwd', { mode: 'boolean' }).notNull().default(false),
  requiresBpl: integer('requires_bpl', { mode: 'boolean' }).notNull().default(false),
  eligibilityText: text('eligibility_text').notNull(),
  // estimated_eligible = population x (basis share) x factor
  eligibleBasis: text('eligible_basis').notNull(), // population | pct_elderly | pct_widows | pct_pwd
  eligibleFactor: real('eligible_factor').notNull(),
  benefitAmount: integer('benefit_amount').notNull(), // INR per payment
  frequency: text('frequency').notNull(), // monthly | instalment | annual
  slaDays: integer('sla_days').notNull(),
  exclusiveGroup: text('exclusive_group'), // schemes in same group should not overlap for one person
});

export const officers = sqliteTable('officers', {
  id: integer('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  designation: text('designation').notNull(),
  blockId: integer('block_id').notNull().references(() => blocks.id),
  districtId: integer('district_id').notNull().references(() => districts.id),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['STATE_ADMIN', 'DISTRICT_OFFICER'] }).notNull(),
  districtId: integer('district_id').references(() => districts.id),
});

export const beneficiaries = sqliteTable(
  'beneficiaries',
  {
    id: integer('id').primaryKey(),
    aadhaarLast4: text('aadhaar_last4').notNull(),
    aadhaarHash: text('aadhaar_hash').notNull(), // salted SHA-256, used only for dedupe
    name: text('name').notNull(),
    gender: text('gender').notNull(),
    dob: text('dob').notNull(),
    districtId: integer('district_id').notNull().references(() => districts.id),
    blockId: integer('block_id').notNull().references(() => blocks.id),
    village: text('village').notNull(),
    schemeId: integer('scheme_id').notNull().references(() => schemes.id),
    status: text('status', { enum: ['active', 'suspended', 'deceased'] }).notNull(),
    enrolledAt: text('enrolled_at').notNull(),
    deceasedAt: text('deceased_at'),
  },
  (t) => [
    index('ben_block_scheme_idx').on(t.blockId, t.schemeId, t.status),
    index('ben_district_idx').on(t.districtId),
    index('ben_hash_idx').on(t.aadhaarHash),
    index('ben_block_dob_idx').on(t.blockId, t.dob),
  ],
);

export const applications = sqliteTable(
  'applications',
  {
    id: integer('id').primaryKey(),
    refNo: text('ref_no').notNull(),
    applicantName: text('applicant_name').notNull(),
    schemeId: integer('scheme_id').notNull().references(() => schemes.id),
    districtId: integer('district_id').notNull().references(() => districts.id),
    blockId: integer('block_id').notNull().references(() => blocks.id),
    submittedAt: text('submitted_at').notNull(),
    status: text('status', { enum: ['submitted', 'verified', 'approved', 'rejected', 'pending'] }).notNull(),
    decidedAt: text('decided_at'),
    officerId: integer('officer_id').references(() => officers.id),
    pendingStage: text('pending_stage'), // document_check | field_verification | sanction | payment_setup
  },
  (t) => [
    index('app_block_status_idx').on(t.blockId, t.status),
    index('app_district_idx').on(t.districtId),
    index('app_officer_idx').on(t.officerId),
  ],
);

export const disbursements = sqliteTable(
  'disbursements',
  {
    id: integer('id').primaryKey(),
    beneficiaryId: integer('beneficiary_id').notNull().references(() => beneficiaries.id),
    schemeId: integer('scheme_id').notNull(),
    districtId: integer('district_id').notNull(),
    blockId: integer('block_id').notNull(),
    month: text('month').notNull(), // YYYY-MM
    amount: integer('amount').notNull(),
    status: text('status', { enum: ['success', 'failed', 'returned'] }).notNull(),
    paidAt: text('paid_at').notNull(),
  },
  (t) => [
    index('dis_block_month_idx').on(t.blockId, t.month, t.status),
    index('dis_ben_idx').on(t.beneficiaryId),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    userId: integer('user_id'),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    details: text('details'),
    ip: text('ip'),
  },
  (t) => [index('audit_ts_idx').on(t.ts)],
);

export const insightsCache = sqliteTable('insights_cache', {
  key: text('key').primaryKey(),
  kind: text('kind').notNull(), // brief
  districtId: integer('district_id'),
  content: text('content').notNull(), // JSON
  source: text('source').notNull(), // llm | template
  model: text('model'),
  createdAt: text('created_at').notNull(),
});

/** Human-in-the-loop decisions on detected anomalies. */
export const anomalyReviews = sqliteTable('anomaly_reviews', {
  anomalyKey: text('anomaly_key').primaryKey(),
  status: text('status', { enum: ['open', 'reviewed', 'false_positive'] }).notNull(),
  note: text('note'),
  userId: integer('user_id'),
  userEmail: text('user_email'),
  updatedAt: text('updated_at').notNull(),
});

/** express-session storage (see lib/sessionStore.ts). */
export const sessions = sqliteTable('sessions', {
  sid: text('sid').primaryKey(),
  data: text('data').notNull(),
  expires: integer('expires').notNull(),
});

/** Field actions: an insight (anomaly, brief "visit first") turned into an assigned, trackable task. */
export const fieldActions = sqliteTable(
  'field_actions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    districtId: integer('district_id').notNull().references(() => districts.id),
    blockId: integer('block_id').notNull().references(() => blocks.id),
    anomalyId: text('anomaly_id'), // anomaly key (e.g. dup:block:12); anomalies are derived, so no FK
    title: text('title').notNull(),
    assignedToUserId: integer('assigned_to_user_id').notNull().references(() => users.id),
    dueDate: text('due_date').notNull(), // YYYY-MM-DD
    status: text('status', { enum: ['open', 'in_progress', 'done'] }).notNull().default('open'),
    notes: text('notes'),
    createdBy: integer('created_by').notNull().references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('actions_district_status_idx').on(t.districtId, t.status)],
);
