import { json, corsPreflight } from "./helpers.js";
import * as api from "./api.js";
import { handleTelegramWebhook } from "./telegram.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return corsPreflight();

    try {
      // ---------- Telegram webhook ----------
      if (path === "/telegram/webhook" && method === "POST") {
        // Verify Telegram's secret token header to prevent spoofed requests
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
          return new Response("Forbidden", { status: 403 });
        }
        return handleTelegramWebhook(request, env, ctx);
      }

      // ---------- Auth ----------
      if (path === "/api/login" && method === "POST") return api.handleLogin(request, env);
      if (path === "/api/logout" && method === "POST") return api.handleLogout(request, env);

      // ---------- Menu ----------
      if (path === "/api/menu" && method === "GET") return api.getMenu(env);
      if (path === "/api/menu" && method === "POST") return api.createMenuItem(request, env);
      if (path.match(/^\/api\/menu\/[^/]+$/) && method === "PATCH") {
        const id = path.split("/").pop();
        return api.updateMenuItem(request, env, id);
      }
      if (path.match(/^\/api\/menu\/[^/]+$/) && method === "DELETE") {
        const id = path.split("/").pop();
        return api.deleteMenuItem(request, env, id);
      }

      // ---------- Shop info ----------
      if (path === "/api/shop-info" && method === "GET") return api.getShopInfo(env);
      if (path === "/api/shop-info" && method === "PATCH") return api.updateShopInfo(request, env);

      // ---------- Orders ----------
      if (path === "/api/orders" && method === "GET") return api.listOrders(request, env);
      if (path === "/api/orders" && method === "POST") return api.createOrder(request, env, ctx);
      if (path === "/api/orders/by-phone" && method === "GET") return api.getOrdersByPhone(request, env);
      if (path.match(/^\/api\/orders\/[^/]+\/status$/) && method === "PATCH") {
        const id = path.split("/")[3];
        return api.updateOrderStatus(request, env, id, ctx);
      }
      if (path.match(/^\/api\/orders\/[^/]+\/cancel$/) && method === "POST") {
        const id = path.split("/")[3];
        return api.cancelOrder(request, env, id, ctx);
      }
    if (path.match(/^\/api\/orders\/[^\/]+\/cancel-by-buyer$/) && method === "POST") {
      const id = path.split("/")[3];
      return api.cancelOrderByBuyer(request, env, id);
    }
      if (path.match(/^\/api\/orders\/[^/]+\/shipping$/) && method === "PATCH") {
        const id = path.split("/")[3];
        return api.updateShippingCost(request, env, id);
      }

      // ---------- Testimonials ----------
      if (path === "/api/testimonials" && method === "GET") return api.getTestimonials(request, env);
      if (path === "/api/testimonials" && method === "POST") return api.createTestimonial(request, env);
      if (path.match(/^\/api\/testimonials\/[^/]+\/status$/) && method === "PATCH") {
        const id = path.split("/")[3];
        return api.setTestimonialStatus(request, env, id);
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Internal error", detail: String(e.message || e) }, 500);
    }
  },
};
