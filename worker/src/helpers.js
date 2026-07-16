// ============ Helpers ============

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    },
  });
}

export function rupiah(n) {
  return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

export function genOrderId() {
  return "BA" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
}

export function genToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Auth ----------
export async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
  )
    .bind(token)
    .first();
  return !!row;
}

// ---------- WIB time helpers ----------
export function getWibNow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 7 * 60 * 60000);
}

export function isStoreOpen(openHour, closeHour) {
  const wib = getWibNow();
  const hour = wib.getHours();
  return hour >= openHour && hour < closeHour;
}

// ---------- Telegram ----------
export async function tgCall(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

export async function tgSendMessage(env, text, extra = {}) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  return tgCall(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "Markdown",
    ...extra,
  });
}

export async function tgAnswerCallback(env, callbackQueryId, text) {
  return tgCall(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "",
    show_alert: false,
  });
}

export async function tgEditMessageText(env, chatId, messageId, text, extra = {}) {
  return tgCall(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "Markdown",
    ...extra,
  });
}

export function formatOrderForTelegram(order) {
  const items = JSON.parse(order.items_json || "[]");
  const itemLines = items
    .map((i) => `• ${i.name} x${i.qty}${i.isPo ? ` (PO)` : ""}`)
    .join("\n");
  const areaLabel = order.delivery_area === "dalam-kota" ? "Dalam Kota" : "Luar Kota";
  return [
    `🆕 *PESANAN BARU*`,
    `No: \`${order.id}\``,
    `Status: *${order.status}*`,
    ``,
    itemLines,
    ``,
    `Total: *${rupiah(order.total)}*`,
    `Bayar: ${order.payment_method || "-"}`,
    ``,
    `👤 ${order.buyer_name || "-"}`,
    `📱 ${order.buyer_phone || "-"}`,
    `📍 ${order.buyer_addr || "-"} (${areaLabel}${order.expedition ? `, ${order.expedition}` : ""})`,
  ].join("\n");
}

export function orderKeyboard(order) {
  const id = order.id;
  const rows = [];
  if (order.status !== "Selesai" && order.status !== "Dibatalkan") {
    const btns = [];
    if (order.status !== "Diproses") btns.push({ text: "▶️ Diproses", callback_data: `status:${id}:Diproses` });
    if (order.status !== "Selesai") btns.push({ text: "✅ Selesai", callback_data: `status:${id}:Selesai` });
    rows.push(btns);
    rows.push([{ text: "❌ Batalkan", callback_data: `cancel:${id}` }]);
  }
  rows.push([{ text: "🔄 Refresh", callback_data: `refresh:${id}` }]);
  return { inline_keyboard: rows };
}
