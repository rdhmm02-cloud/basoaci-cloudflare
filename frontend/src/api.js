// Ganti nilai ini dengan URL Worker kamu setelah deploy, contoh:
// export const API_BASE = "https://basoaci-api.namakamu.workers.dev";
export const API_BASE = "https://basoaci-api.YOUR_SUBDOMAIN.workers.dev";

function getAdminToken() {
  return localStorage.getItem("basoaci_admin_token") || "";
}

export function setAdminToken(token) {
  if (token) localStorage.setItem("basoaci_admin_token", token);
  else localStorage.removeItem("basoaci_admin_token");
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getAdminToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  // Auth
  login: (pin) => request("/api/login", { method: "POST", body: JSON.stringify({ pin }) }),
  logout: () => request("/api/logout", { method: "POST" }),

  // Menu
  getMenu: () => request("/api/menu"),
  createMenuItem: (item) => request("/api/menu", { method: "POST", body: JSON.stringify(item) }),
  updateMenuItem: (id, patch) => request(`/api/menu/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMenuItem: (id) => request(`/api/menu/${id}`, { method: "DELETE" }),

  // Shop info
  getShopInfo: () => request("/api/shop-info"),
  updateShopInfo: (info) => request("/api/shop-info", { method: "PATCH", body: JSON.stringify(info) }),

  // Orders
  listOrders: () => request("/api/orders"),
  getOrdersByPhone: (phone) => request(`/api/orders/by-phone?phone=${encodeURIComponent(phone)}`),
  createOrder: (order) => request("/api/orders", { method: "POST", body: JSON.stringify(order) }),
  updateOrderStatus: (id, status) => request(`/api/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  cancelOrder: (id, reason) => request(`/api/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  updateShippingCost: (id, shippingCost) => request(`/api/orders/${id}/shipping`, { method: "PATCH", body: JSON.stringify({ shippingCost }) }),

  // Testimonials
  getTestimonials: () => request("/api/testimonials"),
  createTestimonial: (t) => request("/api/testimonials", { method: "POST", body: JSON.stringify(t) }),
  setTestimonialStatus: (id, status) => request(`/api/testimonials/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
};
