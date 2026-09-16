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

export interface CartLine {
  item: MenuItem;
  qty: number;
  note?: string;
  weight?: number; // present only for sold_by_weight items -- the reading (in item.weight_unit) this line was priced at
  lineKey?: string; // stable identity for setQty/removeItem -- multiple weighings of the same item are separate lines
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
