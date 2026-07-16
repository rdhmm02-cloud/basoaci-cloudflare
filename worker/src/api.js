import {
  json,
  rupiah,
  genOrderId,
  genToken,
  requireAdmin,
  isStoreOpen,
  tgSendMessage,
  formatOrderForTelegram,
  orderKeyboard,
} from "./helpers.js";

// ============ PUBLIC: Auth ============
export async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin || "");
  if (!env.ADMIN_PIN || pin !== env.ADMIN_PIN) {
    return json({ error: "PIN salah" }, 401);
  }
  const token = genToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // 12 hours
  await env.DB.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
    .bind(token, expiresAt)
    .run();
  return json({ token, expiresAt });
}

export async function handleLogout(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
  }
  return json({ ok: true });
}

// ============ PUBLIC: Menu ============
export async function getMenu(env) {
  const { results } = await env.DB.prepare("SELECT * FROM menu ORDER BY sort_order ASC").all();
  const menu = results.map((r) => ({
    id: r.id,
    name: r.name,
    tag: r.tag || undefined,
    desc: r.desc || "",
    price: r.price,
    stock: r.stock,
    poEta: r.po_eta || "1-2 jam",
  }));
  return json({ menu });
}

export async function updateMenuItem(request, env, id) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (body.name !== undefined) { fields.push("name = ?"); values.push(body.name); }
  if (body.desc !== undefined) { fields.push("desc = ?"); values.push(body.desc); }
  if (body.price !== undefined) { fields.push("price = ?"); values.push(Number(body.price) || 0); }
  if (body.stock !== undefined) { fields.push("stock = ?"); values.push(Number(body.stock) || 0); }
  if (body.poEta !== undefined) { fields.push("po_eta = ?"); values.push(body.poEta); }
  if (body.tag !== undefined) { fields.push("tag = ?"); values.push(body.tag); }
  if (fields.length === 0) return json({ error: "No fields" }, 400);
  values.push(id);
  await env.DB.prepare(`UPDATE menu SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return json({ ok: true });
}

export async function createMenuItem(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  if (!body.name || !body.name.trim()) return json({ error: "Nama wajib diisi" }, 400);
  const id = (body.id && String(body.id).trim()) ||
    body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
  const { results } = await env.DB.prepare("SELECT MAX(sort_order) as m FROM menu").all();
  const nextOrder = (results[0]?.m || 0) + 1;
  await env.DB.prepare(
    "INSERT INTO menu (id, name, tag, desc, price, stock, po_eta, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, body.name.trim(), body.tag || null, body.desc || "", Number(body.price) || 0, Number(body.stock) || 0, body.poEta || "1-2 jam", nextOrder)
    .run();
  return json({ ok: true, id });
}

export async function deleteMenuItem(request, env, id) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  await env.DB.prepare("DELETE FROM menu WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ============ PUBLIC: Shop info ============
export async function getShopInfo(env) {
  const row = await env.DB.prepare("SELECT * FROM shop_info WHERE id = 1").first();
  return json({
    shopInfo: {
      name: row.name,
      phone: row.phone,
      address: row.address,
      openHour: row.open_hour,
      closeHour: row.close_hour,
      paymentAccounts: JSON.parse(row.payment_accounts_json || "{}"),
    },
  });
}

export async function updateShopInfo(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  await env.DB.prepare(
    `UPDATE shop_info SET name=?, phone=?, address=?, open_hour=?, close_hour=?, payment_accounts_json=? WHERE id=1`
  )
    .bind(
      body.name || "",
      body.phone || "",
      body.address || "",
      Number(body.openHour ?? 8),
      Number(body.closeHour ?? 19),
      JSON.stringify(body.paymentAccounts || {})
    )
    .run();
  return json({ ok: true });
}

// ============ PUBLIC: Orders ============
function rowToOrder(r) {
  return {
    id: r.id,
    buyerName: r.buyer_name,
    buyerPhone: r.buyer_phone,
    buyerAddr: r.buyer_addr,
    deliveryArea: r.delivery_area,
    expedition: r.expedition,
    paymentMethod: r.payment_method,
    items: JSON.parse(r.items_json || "[]"),
    total: r.total,
    shippingCost: r.shipping_cost,
    isPo: !!r.is_po,
    status: r.status,
    cancelReason: r.cancel_reason,
    cancelledAt: r.cancelled_at,
    stockDeducted: !!r.stock_deducted,
    createdAt: r.created_at,
  };
}

export async function listOrders(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const { results } = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  return json({ orders: results.map(rowToOrder) });
}

// Public: allow a buyer to fetch their own order history by phone number (no admin auth)
export async function getOrdersByPhone(request, env) {
  const url = new URL(request.url);
  const phone = (url.searchParams.get("phone") || "").replace(/\D/g, "");
  if (!phone) return json({ orders: [] });
  let digits = phone;
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  if (!digits.startsWith("62")) digits = "62" + digits;
  const { results } = await env.DB.prepare(
    "SELECT * FROM orders WHERE REPLACE(REPLACE(REPLACE(buyer_phone,'-',''),' ',''),'+','') LIKE ? ORDER BY created_at DESC LIMIT 20"
  )
    .bind(`%${digits.slice(-9)}%`)
    .all();
  return json({ orders: results.map(rowToOrder) });
}

export async function createOrder(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return json({ error: "Keranjang kosong" }, 400);
  if (!body.buyerName || !body.buyerPhone || !body.buyerAddr) {
    return json({ error: "Data pembeli belum lengkap" }, 400);
  }

  const shop = await env.DB.prepare("SELECT open_hour, close_hour FROM shop_info WHERE id=1").first();
  if (!isStoreOpen(shop.open_hour, shop.close_hour)) {
    return json({ error: `Toko sedang tutup. Buka pukul ${shop.open_hour}.00 WIB.` }, 400);
  }

  // Validate stock server-side
  const menuRows = await env.DB.prepare("SELECT * FROM menu").all();
  const menuMap = Object.fromEntries(menuRows.results.map((m) => [m.id, m]));
  for (const it of items) {
    const m = menuMap[it.id];
    if (!m) return json({ error: `Menu ${it.name || it.id} tidak ditemukan` }, 400);
    if (m.stock > 0 && it.qty > m.stock) {
      return json({ error: `Stok ${m.name} tinggal ${m.stock}` }, 400);
    }
  }

  const orderId = genOrderId();
  const hasPo = items.some((i) => {
    const m = menuMap[i.id];
    return !m || (m.stock ?? 0) <= 0;
  });
  const total = items.reduce((sum, i) => sum + (i.price || 0) * (i.qty || 0), 0);
  const expedition = body.deliveryArea === "dalam-kota" ? (body.expedition || "GoSend") : "J&T";

  await env.DB.prepare(
    `INSERT INTO orders (id, buyer_name, buyer_phone, buyer_addr, delivery_area, expedition, payment_method, items_json, total, is_po, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Masuk')`
  )
    .bind(
      orderId,
      body.buyerName.trim(),
      body.buyerPhone.trim(),
      body.buyerAddr.trim(),
      body.deliveryArea || "dalam-kota",
      expedition,
      body.paymentMethod || "",
      JSON.stringify(items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, price: i.price, isPo: (menuMap[i.id]?.stock ?? 0) <= 0, poEta: menuMap[i.id]?.po_eta || null }))),
      total,
      hasPo ? 1 : 0
    )
    .run();

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();

  // Notify admin via Telegram (don't block the response on this)
  ctx.waitUntil(
    tgSendMessage(env, formatOrderForTelegram(order), { reply_markup: orderKeyboard(order) })
  );

  return json({ ok: true, order: rowToOrder(order) });
}

export async function updateOrderStatus(request, env, id, ctx) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (!["Masuk", "Diproses", "Selesai"].includes(status)) return json({ error: "Status tidak valid" }, 400);

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order) return json({ error: "Order tidak ditemukan" }, 404);

  // Deduct stock once, when transitioning into "Diproses" for the first time
  if (status === "Diproses" && !order.stock_deducted) {
    const items = JSON.parse(order.items_json || "[]");
    for (const it of items) {
      await env.DB.prepare("UPDATE menu SET stock = MAX(0, stock - ?) WHERE id = ? AND stock > 0")
        .bind(it.qty, it.id)
        .run();
    }
    await env.DB.prepare("UPDATE orders SET stock_deducted = 1 WHERE id = ?").bind(id).run();
  }

  await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(status, id).run();
  return json({ ok: true });
}

export async function cancelOrder(request, env, id, ctx) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order) return json({ error: "Order tidak ditemukan" }, 404);

  // Restore stock if it had been deducted
  if (order.stock_deducted) {
    const items = JSON.parse(order.items_json || "[]");
    for (const it of items) {
      await env.DB.prepare("UPDATE menu SET stock = stock + ? WHERE id = ? AND stock > 0")
        .bind(it.qty, it.id)
        .run();
    }
  }

  await env.DB.prepare(
    "UPDATE orders SET status = 'Dibatalkan', cancel_reason = ?, cancelled_at = datetime('now'), stock_deducted = 0 WHERE id = ?"
  )
    .bind(body.reason || "", id)
    .run();

  return json({ ok: true });
}

export async function updateShippingCost(request, env, id) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  await env.DB.prepare("UPDATE orders SET shipping_cost = ? WHERE id = ?")
    .bind(Number(body.shippingCost) || 0, id)
    .run();
  return json({ ok: true });
}

// ============ PUBLIC: Testimonials ============
export async function getTestimonials(request, env) {
  const url = new URL(request.url);
  const isAdmin = await requireAdmin(request, env);
  let query = "SELECT * FROM testimonials";
  if (!isAdmin) query += " WHERE status = 'approved'";
  query += " ORDER BY created_at DESC";
  const { results } = await env.DB.prepare(query).all();
  return json({
    testimonials: results.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      rating: t.rating,
      comment: t.comment,
      status: t.status,
      createdAt: t.created_at,
    })),
  });
}

export async function createTestimonial(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body.name || !body.comment) return json({ error: "Data belum lengkap" }, 400);

  const cleanPhone = String(body.phone || "").replace(/\D/g, "");
  if (!cleanPhone) return json({ error: "Nomor HP tidak valid." }, 400);

  const hasOrdered = await env.DB.prepare(
    "SELECT 1 FROM orders WHERE REPLACE(REPLACE(REPLACE(buyer_phone,'-',''),' ',''),'+','') LIKE ? LIMIT 1"
  )
    .bind(`%${cleanPhone.slice(-9)}%`)
    .first();
  if (!hasOrdered) {
    return json({ error: "Nomor HP ini tidak ditemukan di riwayat pesanan kami." }, 400);
  }

  const id = "T" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  await env.DB.prepare(
    "INSERT INTO testimonials (id, name, phone, rating, comment, status) VALUES (?, ?, ?, ?, ?, 'pending')"
  )
    .bind(id, body.name.trim(), body.phone || "", Number(body.rating) || 5, body.comment.trim())
    .run();
  return json({ ok: true, id });
}

export async function setTestimonialStatus(request, env, id) {
  if (!(await requireAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  if (!["pending", "approved", "rejected"].includes(body.status)) return json({ error: "Status tidak valid" }, 400);
  await env.DB.prepare("UPDATE testimonials SET status = ? WHERE id = ?").bind(body.status, id).run();
  return json({ ok: true });
}
