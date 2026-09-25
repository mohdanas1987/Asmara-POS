// Field names match the real Phase 1 backend responses exactly (routes/items.js,
// routes/menu.js, routes/tables.js) -- not guessed at.

export interface MenuItem {
  id: number;
  name: string;
  price: number; // for sold_by_weight items, this is PRICE PER UNIT (per weight_unit), not per item
  code?: string;
  tax?: number;
  image?: string | null;
  quantity: number;
  pos: number;
  category_id: number;
  catName?: string;
  sold_by_weight?: boolean | number; // SQLite returns 0/1 -- callers should coerce with Boolean(...)
  weight_unit?: 'kg' | 'g' | 'lb';
  // Course firing (CTO forensic audit 2026-09-20): unset/'starter' fires to the kitchen
  // immediately; any other value is held at the POS until a waiter fires that course.
  course?: 'starter' | 'main' | 'dessert' | 'other' | null;
}

// Menu modifiers & spice levels (task #40) -- see backend routes/modifiers.js.
export interface Modifier {
  id: number;
  modifier_group_id: number;
  name: string;
  price_delta: string | number;
}

export interface ModifierGroup {
  id: number;
  menu_item_id: number;
  name: string;
  selection_type: 'single' | 'multiple';
  required: boolean | number;
  min_select: number;
  max_select: number | null;
  modifiers: Modifier[];
}

export interface MenuCategory {
  id: number;
  name: string;
}

// Menu UX refinement (task #36): a tenant's configured VAT/tax rates (routes/tax.js).
// `amount` is the raw string this app has always stored tax as elsewhere ("9%", "9"), and is
// exactly what gets copied into MenuItem.tax when an item is assigned this rate.
export interface TaxRate {
  id: number;
  name: string;
  amount: string;
  status: boolean | number;
}

// Modifiers wired into real order lines (CTO forensic audit 2026-09-20, "Gate 1: Order
// domain completion" -- migration 0015 built the menu-configuration side of modifiers
// (groups + options) but deliberately never touched the cart/order data model; this is that
// follow-up. A SelectedModifier is a frozen snapshot of one chosen option (id/name/price at
// the moment it was added) -- NOT a live reference to the ModifierGroup config, so a later
// edit to a modifier's price in Settings never retroactively changes an already-placed order.
export interface SelectedModifier {
  id: number;
  name: string;
  price_delta: number;
}

export interface CartLine {
  item: MenuItem;
  qty: number;
  note?: string;
  weight?: number; // present only for sold_by_weight items -- the reading (in item.weight_unit) this line was priced at
  lineKey?: string; // stable identity for setQty/removeItem -- multiple weighings of the same item are separate lines
  modifiers?: SelectedModifier[]; // e.g. [{name: 'Extra cheese', price_delta: 1.50}, {name: 'No onion', price_delta: 0}]
  // Seat & guest architecture (CTO doc "Asmara POS -- Remaining Work Only", Phase 22): which
  // seat (1-based, scoped to this order -- see backend migrations_local/0026's header
  // comment) this line is for. Undefined/absent means "not assigned to a seat" -- a shared
  // starter, or an order nobody has bothered to seat-split -- and is always valid; nothing
  // requires a seat to be set.
  seat?: number;
}

// Seat & guest architecture: an order's named seats (backend's order_guests table), as
// returned by GET /orders/:order/guests.
export interface OrderGuest {
  seat_number: number;
  guest_name: string | null;
}

// Course firing (CTO forensic audit 2026-09-20): what's currently held back from the
// kitchen for one order, grouped by course -- see GET /kitchen/held-courses/:orderId.
export interface HeldCourse {
  course: string;
  items: Array<{ id: number | string; quantity: number }>;
}

// Staff quick-login: PIN + QR badge (CTO forensic audit 2026-09-20).
export interface StaffMember {
  id: number;
  name: string;
  email: string;
  role: string;
  type?: string;
  status: boolean | number;
  created_at?: string;
  has_pin: boolean;
  has_qr_badge: boolean;
}

// role_permissions as a real, editable table (CTO forensic audit 2026-09-20).
export interface RolePermissionEntry {
  permission: string;
  enabled: boolean;
  isOverride: boolean;
  default: boolean;
}

export interface RolePermissionRow {
  role: string;
  permissions: RolePermissionEntry[];
}

export interface Table {
  id: number;
  table_number: string;
  status: string;
  className: string;
  x: number;
  y: number;
  length: number;
  width: number;
  linked_to?: number | null;
}

export interface CashRegisterSession {
  id: number;
  status: boolean;
  opening_cash: number;
  closing_cash: number;
  date: string;
}

export interface Order {
  id: number;
  status: string;
  total: number;
  payment_status: string;
  tables?: string | null;
}

export interface TableRow {
  id: number;
  table_number: string;
  length: number;
  width: number;
  x: number;
  y: number;
  status: string;
  className: 'success' | 'primary' | 'warning' | 'danger' | string;
  linked_to?: number | null;
  // Table/Floor management redesign (project audit 2026-09-15).
  capacity?: number | null;
  section?: string | null;
  // Seat / server assignment (CTO forensic audit 2026-09-21, P1).
  assigned_server_id?: number | null;
}

export interface OrderRow {
  id: string;
  source: 'pos' | 'online';
  tables: string | null;
  cash_register_id: number | null;
  user_id: number | null;
  customer_id: number | null;
  status: string;
  payment_status: string;
  payment_mode: string | null;
  total: number | null;
  note: string | null;
  taste: string | null;
  created_at: string;
  updated_at: string;
  cashier?: { id: number; name: string } | null;
}

export interface TableOrderInfo {
  id: number;
  data: { quantity?: Record<string, number> };
  status: string;
  payment: string;
  taste?: string | null;
  total?: number | null;
  note?: string | null;
  // Table/Floor management redesign (project audit 2026-09-15): powers the elapsed-time
  // display ("seated 42m ago") on each occupied table.
  created_at?: string;
}

export interface OrdersResponse {
  status: boolean;
  orders: OrderRow[];
  products: Record<string, string>;
  tableOrders: Record<string, TableOrderInfo>;
}

export interface Customer {
  id: number;
  name: string;
  email?: string | null;
  phone: string;
  note?: string | null;
  customer_code?: string | null;
}

// Customer QR/barcode identity + printable loyalty card (task #48). Backend has carried
// customer_code and this ledger shape since the loyalty subsystem was built (task #31) --
// nothing in the frontend read either until now.
export interface LoyaltyLedgerRow {
  id: number;
  customer_id: number;
  order_id?: string | null;
  type: 'earn' | 'redeem' | 'adjust';
  points: number;
  balance_after: number;
  reason?: string | null;
  created_at: string;
}

export interface ReportRow {
  id: number;
  path: string | null;
  html: string | null;
  date: string | null;
  created_at: string;
}

export interface SalesReportData {
  range: { from: string; to: string };
  totals: { revenue: number; orders: number; avgOrderValue: number; partialOrders: number };
  byDay: { date: string; revenue: number; orders: number }[];
  byCategory: { category: string; revenue: number }[];
  byPaymentMethod: { cash: number; card: number; account: number };
  topItems: { id: string; name: string; quantity: number; revenue: number }[];
}

export interface TablePerformanceRow {
  table: string;
  capacity: number | null;
  section: string | null;
  orders: number;
  revenue: number;
  avgOrderValue: number;
  avgTurnoverMinutes: number | null;
  lastUsed: string | null;
}

export interface TablePerformanceData {
  range: { from: string; to: string };
  tables: TablePerformanceRow[];
}

export interface WebsiteStatus {
  connected: boolean;
  website_url: string | null;
  api_key_masked: string | null;
}

export type PaymentProvider = 'stripe' | 'adyen' | 'sumup' | 'mollie';

export interface PaymentTerminalStatus {
  connected: boolean;
  provider: PaymentProvider | null;
  terminal_id: string | null;
  api_key_masked: string | null;
}

export interface AdminTenant {
  id: number;
  name: string;
  slug: string;
  status: boolean | number;
  created_at: string;
  user_count: number;
  order_count: number;
  last_order_at: string | null;
  subscription_status: string | null;
  plan_name: string | null;
}

// --- Billing groundwork: dynamic plans + platform payment partners, fully managed by the
// platform admin from the Super Admin panel -- nothing hardcoded here (see
// routes/billing-admin.js and routes/billing.js on the backend). Renamed to avoid colliding
// with the existing `PaymentProvider` type above, which is the in-restaurant payment
// TERMINAL provider (Stripe Terminal/Adyen/SumUp/Mollie) -- a completely separate concept
// from a platform billing partner.
export interface Plan {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: string;
  features: string | null; // JSON-encoded string array
  is_active: boolean | number;
  is_default: boolean | number;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface BillingPaymentProvider {
  id: number;
  name: string;
  provider_key: string;
  mode: 'sandbox' | 'live';
  config: string | null;
  is_active: boolean | number;
  created_at?: string;
  updated_at?: string;
}

export interface Subscription {
  id: number;
  tenant_id: number;
  plan_id: number | null;
  payment_provider_id: number | null;
  status: string;
  current_period_end: string | null;
  plan?: Plan | null;
  paymentProvider?: BillingPaymentProvider | null;
}
