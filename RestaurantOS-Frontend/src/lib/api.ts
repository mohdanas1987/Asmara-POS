/**
 * Thin fetch wrapper for the Phase 1 backend. Every request goes through the
 * Next.js dev proxy (see next.config.mjs) which points at localhost:5102 —
 * the existing Docker-Backend-Test container. Never hits srv1399.hstgr.io.
 *
 * Auth: the existing backend expects the JWT on an "asmara-token" header
 * (preserved from the original app so the same JWT/tenant-resolution logic
 * built in Phase 1 keeps working unchanged).
 */

const TOKEN_KEY = 'restaurantos_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['asmara-token'] = token;

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401) {
    // Stale/missing/expired token -- self-heal instead of leaving the screen stuck on a
    // silent 401 with no way to navigate anywhere (DashboardLayout's guard normally catches
    // this before any request fires, but this covers a token that goes bad mid-session too).
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Session expired -- redirecting to login.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Some backend routes (items create/update) use multer's upload.single(), which needs a
// real multipart/form-data body -- NOT JSON. Deliberately omits the Content-Type header so
// the browser sets its own multipart boundary; setting it manually (as apiFetch does for
// JSON) would corrupt the request.
export async function apiFetchForm<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['asmara-token'] = token;

  const res = await fetch(`/api${path}`, { method: 'POST', headers, body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string) {
  return apiFetch<{ authToken: string; tenant_id: number }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// Real tenant onboarding (routes/auth.js POST /signup-tenant) -- creates a brand-new
// restaurant + its first admin user in one transaction and logs them straight in.
export async function signupTenant(input: { restaurant_name: string; name: string; email: string; password: string; plan_id?: number }) {
  return apiFetch<{
    status: boolean;
    message?: string;
    authToken?: string;
    tenant_id?: number;
    tenant_name?: string;
    tenant_slug?: string;
    key?: string;
    errors?: { msg: string }[];
    subscription_status?: string;
    plan_id?: number | null;
  }>('/auth/signup-tenant', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Public, unauthenticated -- the signup page fetches this before anyone is logged in.
export async function getPublicPlans() {
  return apiFetch<{ status: boolean; plans: import('./types').Plan[] }>('/billing/plans');
}

// --- Cash register (must be open before any sale can be charged — see /orders/create) ---

export async function getLastActiveSession() {
  return apiFetch<{ status: boolean; session: import('./types').CashRegisterSession | null }>(
    '/pos/last-active-session'
  );
}

export async function openRegister(openingCash: number) {
  return apiFetch<{ status: boolean; created: import('./types').CashRegisterSession; message: string }>(
    '/pos/opening-day-cash-amount',
    { method: 'POST', body: JSON.stringify({ cash: openingCash }) }
  );
}

// --- Real order lifecycle (table-first backend; this is the "direct sale" / counter-sale
// path -- no table required, matches this POS screen's cart-first UX) ---

export async function sendDirectSaleToKitchen(
  quantities: Record<number, number>,
  total: number,
  weights?: Record<string, { itemName: string; weight: number; unit: string }>
) {
  const data: Record<string, unknown> = { quantity: quantities };
  if (weights && Object.keys(weights).length > 0) {
    data.weights = weights; // weight-based line detail, for receipt/kitchen display only
  }
  return apiFetch<{ status: boolean; order: import('./types').Order; message: string }>(
    '/orders/to-kitchen',
    { method: 'POST', body: JSON.stringify({ data, total }) }
  );
}

export async function chargeOrder(orderId: number, total: number, method: 'cash' | 'card') {
  return apiFetch<{ status: boolean; message: string; order: import('./types').Order }>(
    '/orders/create',
    {
      method: 'POST',
      body: JSON.stringify({
        order_id: orderId,
        total,
        payment_mode: method,
        data: { [method]: total },
      }),
    }
  );
}

// --- Tables / floor plan (routes/tables.js — table-transfer already covered by Phase 1's
// automated test suite; these calls hit the exact same, already-tested endpoints) ---

export async function getTables() {
  return apiFetch<{ status: boolean; tables: import('./types').TableRow[] }>('/tables/');
}

export async function updateTablePosition(tableNumber: string, x: number, y: number) {
  return apiFetch<{ status: boolean; message: string }>(
    `/tables/update-position/${encodeURIComponent(tableNumber)}`,
    { method: 'POST', body: JSON.stringify({ x, y }) }
  );
}

export async function transferTable(fromTable: string, toTable: string) {
  return apiFetch<{ status: boolean; message: string }>('/tables/transfer', {
    method: 'POST',
    body: JSON.stringify({ from_table: fromTable, to_table: toTable }),
  });
}

export async function freeAllTables() {
  return apiFetch<{ status: boolean; message: string }>('/tables/free-all', { method: 'POST' });
}

// --- Orders (routes/orders.js GET /) ---

export async function getOrders() {
  return apiFetch<import('./types').OrdersResponse>('/orders/');
}

// --- Menu management (routes/menu.js categories, routes/items.js products) ---
//
// NOTE: items.js's DELETE route ("/items/remove/:id") calls an external third-party
// endpoint (https://pos.dftech.in/products/remove-product) with the product's data --
// a leftover vendor integration discovered while reading the route, not something this
// frontend wires up. Deleting items is intentionally NOT built here; flagged for a real
// decision (rip the external call out server-side, or keep it and disclose it) before any
// UI ever triggers it.

export async function createCategory(name: string) {
  return apiFetch<{ status: boolean; category: { id: number; name: string } }>('/menu/create', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateCategory(id: number, name: string, status: boolean) {
  return apiFetch<{ status: boolean; message: string }>('/menu/update', {
    method: 'POST',
    body: JSON.stringify({ id, name, status }),
  });
}

export async function updateItemStock(id: number, quantity: number) {
  return apiFetch<{ status: boolean; message: string }>(`/items/updateStock/${id}`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

export async function toggleItemOnPos(id: number, nextStatus: boolean) {
  return apiFetch<{ status: boolean }>(`/items/update-product-pos/${id}/${nextStatus}`, {
    method: 'PATCH',
  });
}

// --- Website integration (routes/website.js) ---

export async function getWebsiteStatus() {
  return apiFetch<{ status: boolean } & import('./types').WebsiteStatus>('/website/status');
}

export async function connectWebsite(websiteUrl: string) {
  return apiFetch<{ status: boolean; message: string; api_key: string }>('/website/connect', {
    method: 'POST',
    body: JSON.stringify({ website_url: websiteUrl }),
  });
}

export async function disconnectWebsite() {
  return apiFetch<{ status: boolean; message: string }>('/website/disconnect', { method: 'POST' });
}

// --- Payment terminal (routes/payments.js) ---

export async function getPaymentStatus() {
  return apiFetch<{ status: boolean } & import('./types').PaymentTerminalStatus>('/payments/status');
}

export async function connectPaymentProvider(params: {
  provider: import('./types').PaymentProvider;
  api_key: string;
  api_secret?: string;
  terminal_id?: string;
}) {
  return apiFetch<{ status: boolean; message: string }>('/payments/connect', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function disconnectPaymentProvider() {
  return apiFetch<{ status: boolean; message: string }>('/payments/disconnect', { method: 'POST' });
}

// --- Menu item create/edit (routes/items.js POST /create, /update) ---
// Both use multer's upload.single() -- see apiFetchForm above. category_id is required by
// the backend for a real category lookup only if provided (routes/items.js guards a missing
// one, see the backend's VERIFICATION.md entry) -- omit it for a categoryless item.

export interface ItemFormInput {
  name: string;
  price: string; // price-per-item, or price-PER-UNIT when sold_by_weight is true
  barcode?: string;
  category_id?: number;
  sold_by_weight?: boolean;
  weight_unit?: 'kg' | 'g' | 'lb';
  image?: File | null;
}

export async function createItem(input: ItemFormInput) {
  const form = new FormData();
  form.set('name', input.name);
  form.set('price', input.price);
  if (input.barcode) form.set('barcode', input.barcode);
  if (input.category_id) form.set('category_id', String(input.category_id));
  form.set('sold_by_weight', String(!!input.sold_by_weight));
  form.set('weight_unit', input.weight_unit || 'kg');
  if (input.image) form.set('image', input.image);
  return apiFetchForm<{ status: boolean; message: string; product: import('./types').MenuItem }>(
    '/items/create',
    form
  );
}

export async function updateItem(id: number, input: ItemFormInput & { code: string; existingImage?: string | null }) {
  const form = new FormData();
  form.set('id', String(id));
  form.set('name', input.name);
  form.set('price', input.price);
  form.set('code', input.code);
  form.set('image', input.existingImage ?? 'null');
  if (input.category_id) form.set('category_id', String(input.category_id));
  form.set('sold_by_weight', String(!!input.sold_by_weight));
  form.set('weight_unit', input.weight_unit || 'kg');
  if (input.image) form.set('uploaded', input.image);
  return apiFetchForm<{ status: boolean; updated: import('./types').MenuItem }>('/items/update', form);
}

// --- Customers (routes/pos.js) ---

export async function getCustomers() {
  return apiFetch<import('./types').Customer[]>('/pos/customers');
}

export async function createCustomer(input: { first_name: string; last_name: string; email?: string; phone: string; note?: string }) {
  return apiFetch<{ status: boolean; message: string; customers: import('./types').Customer[] }>(
    '/pos/create-customer',
    { method: 'POST', body: JSON.stringify(input) }
  );
}

// --- Reports (routes/orders.js) ---

export async function generateXReport() {
  return apiFetch<{ status: boolean; message: string; html: string }>('/orders/x-report', {
    method: 'POST',
    body: JSON.stringify({ today: true }),
  });
}

export async function generateZReport() {
  return apiFetch<{ status: boolean; message: string; html: string }>('/orders/z-report', {
    method: 'POST',
    body: JSON.stringify({ today: true }),
  });
}

export async function getReportHistory() {
  return apiFetch<{ status: boolean; reports: import('./types').ReportRow[] }>('/orders/reports');
}

export async function removeReport(id: number) {
  return apiFetch<{ status: boolean; message: string }>(`/orders/remove-report/${id}`, { method: 'DELETE' });
}

// --- Kitchen display (routes/orders.js) ---

export async function finishOrder(orderId: string, tables: string) {
  return apiFetch<{ status: boolean; message: string }>(`/orders/finish/${orderId}/${tables}`, {
    method: 'POST',
  });
}

// Separate, minimal routes (not /to-kitchen or /finish) so accepting/preparing an order
// never risks clobbering an online order's stored data or crashing on a null table -- see
// the comment above them in routes/orders.js.
export async function acceptOrder(orderId: string) {
  return apiFetch<{ status: boolean; message: string; order: import('./types').OrderRow }>(
    `/orders/accept/${orderId}`,
    { method: 'POST' }
  );
}

export async function markOrderPrepared(orderId: string) {
  return apiFetch<{ status: boolean; message: string; order: import('./types').OrderRow }>(
    `/orders/prepared/${orderId}`,
    { method: 'POST' }
  );
}

// --- Super-admin panel (routes/superadmin.js) -- platform-admin-only, cross-tenant ---

export async function getAdminTenants() {
  return apiFetch<{ status: boolean; tenants: import('./types').AdminTenant[] }>('/superadmin/tenants');
}

export async function toggleTenantStatus(id: number) {
  return apiFetch<{ status: boolean; tenant: import('./types').AdminTenant }>(`/superadmin/tenants/${id}/toggle`, {
    method: 'POST',
  });
}

// --- Billing groundwork: dynamic plans + payment partners (platform admin only). Every
// route here is gated by requirePlatformAdmin on the backend -- see routes/billing-admin.js.
// This is deliberately a full CRUD surface (not fixed tiers) per explicit instruction: the
// platform admin adds/edits as many plans and payment partners as they want from the UI.

export async function getAdminPlans() {
  return apiFetch<{ status: boolean; plans: import('./types').Plan[] }>('/superadmin/billing/plans');
}

export async function createPlan(input: Omit<Partial<import('./types').Plan>, 'features'> & { name: string; slug: string; features?: string[] | string }) {
  return apiFetch<{ status: boolean; plan: import('./types').Plan; message?: string }>('/superadmin/billing/plans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updatePlan(id: number, input: Omit<Partial<import('./types').Plan>, 'features'> & { features?: string[] | string }) {
  return apiFetch<{ status: boolean; plan: import('./types').Plan; message?: string }>(`/superadmin/billing/plans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deletePlan(id: number) {
  return apiFetch<{ status: boolean; message?: string; plan?: import('./types').Plan }>(`/superadmin/billing/plans/${id}`, {
    method: 'DELETE',
  });
}

export async function getAdminPaymentProviders() {
  return apiFetch<{ status: boolean; payment_providers: import('./types').BillingPaymentProvider[] }>(
    '/superadmin/billing/payment-providers'
  );
}

export async function createPaymentProvider(input: { name: string; provider_key: string; mode?: 'sandbox' | 'live'; config?: string }) {
  return apiFetch<{ status: boolean; payment_provider: import('./types').BillingPaymentProvider }>(
    '/superadmin/billing/payment-providers',
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export async function updatePaymentProvider(id: number, input: Partial<import('./types').BillingPaymentProvider>) {
  return apiFetch<{ status: boolean; payment_provider: import('./types').BillingPaymentProvider; message?: string }>(
    `/superadmin/billing/payment-providers/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
}

export async function deletePaymentProvider(id: number) {
  return apiFetch<{ status: boolean; message?: string; payment_provider?: import('./types').BillingPaymentProvider }>(
    `/superadmin/billing/payment-providers/${id}`,
    { method: 'DELETE' }
  );
}

export async function getTenantSubscription(tenantId: number) {
  return apiFetch<{ status: boolean; subscription: import('./types').Subscription | null }>(
    `/superadmin/billing/tenants/${tenantId}/subscription`
  );
}

export async function setTenantSubscription(
  tenantId: number,
  input: { plan_id?: number | null; payment_provider_id?: number | null; status?: string }
) {
  return apiFetch<{ status: boolean; subscription: import('./types').Subscription }>(
    `/superadmin/billing/tenants/${tenantId}/subscription`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

// --- Table-based ordering (routes/orders.js /init/:table, /to-kitchen/:table, /cancel) ---
// Wires the tables floor plan to the real per-table order lifecycle that already exists on
// the backend (ported from the original app) -- starting an order locks the table (amber),
// sending to kitchen marks it occupied (red), finishing/cancelling frees it (green).

export async function initTableOrder(tableNumber: string) {
  return apiFetch<{ status: boolean; message?: string; order?: import('./types').Order; table?: import('./types').TableRow }>(
    `/orders/init/${encodeURIComponent(tableNumber)}`
  );
}

export async function sendTableOrderToKitchen(
  tableNumber: string,
  orderId: number | string,
  quantities: Record<number, number>,
  total: number
) {
  return apiFetch<{ status: boolean; message: string; order: import('./types').Order }>(
    `/orders/to-kitchen/${encodeURIComponent(tableNumber)}`,
    { method: 'POST', body: JSON.stringify({ order_id: orderId, data: { quantity: quantities }, total }) }
  );
}

export async function cancelOrder(orderId: number | string, tables: string) {
  return apiFetch<{ status: boolean; message: string }>(
    `/orders/cancel/${orderId}/${encodeURIComponent(tables)}`,
    { method: 'POST' }
  );
}
