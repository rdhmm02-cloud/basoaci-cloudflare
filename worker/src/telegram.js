import {
  tgSendMessage,
  tgAnswerCallback,
  tgEditMessageText,
  formatOrderForTelegram,
  orderKeyboard,
  rupiah,
} from "./helpers.js";

function isFromAdmin(env, chatId) {
  return String(chatId) === String(env.TELEGRAM_CHAT_ID);
}

// In-memory-ish "waiting for input" flow uses a tiny KV-less trick:
// we encode the pending action into the callback_data itself, and for
// text commands we parse args directly from the message, so no server-side
// conversation state is needed (keeps the Worker stateless between requests).

async function handleStatusChange(env, ctx, orderId, newStatus, chatId, messageId) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return "Order tidak ditemukan.";

  if (newStatus === "Diproses" && !order.stock_deducted) {
    const items = JSON.parse(order.items_json || "[]");
    for (const it of items) {
      await env.DB.prepare("UPDATE menu SET stock = MAX(0, stock - ?) WHERE id = ? AND stock > 0")
        .bind(it.qty, it.id)
        .run();
    }
    await env.DB.prepare("UPDATE orders SET stock_deducted = 1 WHERE id = ?").bind(orderId).run();
  }

  await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(newStatus, orderId).run();
  const updated = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();

  await tgEditMessageText(env, chatId, messageId, formatOrderForTelegram(updated), {
    reply_markup: orderKeyboard(updated),
  });
  return `Status ${orderId} → ${newStatus}`;
}

async function handleCancel(env, ctx, orderId, chatId, messageId) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return "Order tidak ditemukan.";

  if (order.stock_deducted) {
    const items = JSON.parse(order.items_json || "[]");
    for (const it of items) {
      await env.DB.prepare("UPDATE menu SET stock = stock + ? WHERE id = ? AND stock > 0")
        .bind(it.qty, it.id)
        .run();
    }
  }

  await env.DB.prepare(
    "UPDATE orders SET status = 'Dibatalkan', cancelled_at = datetime('now'), stock_deducted = 0, cancel_reason = 'Dibatalkan via Telegram' WHERE id = ?"
  )
    .bind(orderId)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  await tgEditMessageText(env, chatId, messageId, formatOrderForTelegram(updated) + "\n\n❌ *DIBATALKAN*", {
    reply_markup: { inline_keyboard: [] },
  });
  return `Order ${orderId} dibatalkan.`;
}

async function handleRefresh(env, orderId, chatId, messageId) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return "Order tidak ditemukan.";
  await tgEditMessageText(env, chatId, messageId, formatOrderForTelegram(order), {
    reply_markup: orderKeyboard(order),
  });
  return "Refreshed.";
}

async function handleCallbackQuery(env, ctx, cq) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  if (!isFromAdmin(env, chatId)) {
    await tgAnswerCallback(env, cq.id, "Bukan admin.");
    return;
  }
  const data = cq.data || "";
  const [action, orderId, arg] = data.split(":");

  let resultText = "OK";
  try {
    if (action === "status") resultText = await handleStatusChange(env, ctx, orderId, arg, chatId, messageId);
    else if (action === "cancel") resultText = await handleCancel(env, ctx, orderId, chatId, messageId);
    else if (action === "refresh") resultText = await handleRefresh(env, orderId, chatId, messageId);
  } catch (e) {
    resultText = "Gagal: " + (e.message || e);
  }
  await tgAnswerCallback(env, cq.id, resultText);
}

// ---------- Text commands ----------
const HELP_TEXT = [
  "*Perintah yang tersedia:*",
  "",
  "/menu — lihat daftar menu & stok",
  "/stok <id> <jumlah> — update stok menu",
  "/harga <id> <harga> — update harga menu",
  "/pesanan — lihat pesanan yang belum selesai",
  "/cari <no.pesanan> — cari 1 pesanan spesifik",
  "/help — tampilkan bantuan ini",
].join("\n");

async function cmdMenu(env) {
  const { results } = await env.DB.prepare("SELECT * FROM menu ORDER BY sort_order ASC").all();
  if (results.length === 0) return "Belum ada menu.";
  const lines = results.map(
    (m) => `\`${m.id}\` — ${m.name}\n  Harga: ${rupiah(m.price)} | Stok: ${m.stock > 0 ? m.stock : "PO"}`
  );
  return "*DAFTAR MENU*\n\n" + lines.join("\n\n");
}

async function cmdStok(env, args) {
  const [id, qtyStr] = args;
  if (!id || qtyStr === undefined) return "Format: /stok <id_menu> <jumlah>\nContoh: /stok jando 30";
  const qty = Number(qtyStr);
  if (Number.isNaN(qty) || qty < 0) return "Jumlah stok tidak valid.";
  const m = await env.DB.prepare("SELECT * FROM menu WHERE id = ?").bind(id).first();
  if (!m) return `Menu dengan id \`${id}\` tidak ditemukan. Cek /menu untuk lihat id yang benar.`;
  await env.DB.prepare("UPDATE menu SET stock = ? WHERE id = ?").bind(qty, id).run();
  return `Stok *${m.name}* diubah jadi *${qty}*.`;
}

async function cmdHarga(env, args) {
  const [id, priceStr] = args;
  if (!id || priceStr === undefined) return "Format: /harga <id_menu> <harga>\nContoh: /harga jando 16000";
  const price = Number(priceStr);
  if (Number.isNaN(price) || price < 0) return "Harga tidak valid.";
  const m = await env.DB.prepare("SELECT * FROM menu WHERE id = ?").bind(id).first();
  if (!m) return `Menu dengan id \`${id}\` tidak ditemukan. Cek /menu untuk lihat id yang benar.`;
  await env.DB.prepare("UPDATE menu SET price = ? WHERE id = ?").bind(price, id).run();
  return `Harga *${m.name}* diubah jadi *${rupiah(price)}*.`;
}

async function cmdPesanan(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM orders WHERE status IN ('Masuk','Diproses') ORDER BY created_at DESC LIMIT 10"
  ).all();
  if (results.length === 0) return "Tidak ada pesanan aktif saat ini. 🎉";
  return results.map((o) => formatOrderForTelegram(o)).join("\n\n—————\n\n");
}

async function cmdCari(env, args) {
  const [id] = args;
  if (!id) return "Format: /cari <no.pesanan>";
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id.toUpperCase()).first();
  if (!o) return `Pesanan \`${id}\` tidak ditemukan.`;
  return formatOrderForTelegram(o);
}

async function handleTextMessage(env, ctx, msg) {
  const chatId = msg.chat.id;
  if (!isFromAdmin(env, chatId)) return; // silently ignore non-admin chats
  const text = (msg.text || "").trim();
  if (!text.startsWith("/")) return;

  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.replace(/@\w+$/, ""); // strip @botname suffix

  let reply;
  let extra = {};
  switch (cmd) {
    case "/start":
    case "/help":
      reply = HELP_TEXT;
      break;
    case "/menu":
      reply = await cmdMenu(env);
      break;
    case "/stok":
      reply = await cmdStok(env, args);
      break;
    case "/harga":
      reply = await cmdHarga(env, args);
      break;
    case "/pesanan":
      reply = await cmdPesanan(env);
      break;
    case "/cari": {
      const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind((args[0] || "").toUpperCase()).first();
      if (!o) reply = `Pesanan \`${args[0] || ""}\` tidak ditemukan.`;
      else { reply = formatOrderForTelegram(o); extra = { reply_markup: orderKeyboard(o) }; }
      break;
    }
    default:
      reply = "Perintah tidak dikenal. Ketik /help untuk lihat daftar perintah.";
  }

  await tgSendMessage(env, reply, extra);
}

export async function handleTelegramWebhook(request, env, ctx) {
  const update = await request.json().catch(() => ({}));

  try {
    if (update.callback_query) {
      await handleCallbackQuery(env, ctx, update.callback_query);
    } else if (update.message) {
      await handleTextMessage(env, ctx, update.message);
    }
  } catch (e) {
    // Never let a bad update crash the webhook (Telegram retries on non-200)
    console.error("Telegram webhook error:", e);
  }

  return new Response("OK", { status: 200 });
}
