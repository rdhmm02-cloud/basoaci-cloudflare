import React, { useState, useEffect, useCallback, useRef } from "react";
import { Flame, Plus, Minus, ShoppingBag, MessageCircle, ClipboardList, Settings2, TrendingUp, Check, Clock, X, ChefHat, ExternalLink, Lock, LogOut, Phone, Printer, Store, Star, MessageSquareHeart } from "lucide-react";
import { api, setAdminToken } from "./api.js";

const WHATSAPP_NUMBER = "62882006769302";
// PIN admin sekarang divalidasi di backend (Cloudflare Worker), bukan di sini.
// Notifikasi order baru sekarang dikirim otomatis oleh Worker ke bot Telegram,
// jadi fungsi kirim-ke-spreadsheet lama sudah tidak diperlukan lagi.

const DEFAULT_MENU = [
  { id: "jando", name: "Bakso Aci Jando Manis", tag: "Best Seller", desc: "Isi jando manis khas, kuah rica pedas gurih", price: 15000, stock: 50, poEta: "1-2 jam" },
  { id: "keju", name: "Bakso Aci Keju", desc: "Lumer keju di setiap gigitan", price: 17000, stock: 50, poEta: "1-2 jam" },
  { id: "ayam-cincang-manis", name: "Bakso Aci Ayam Cincang Manis", desc: "Isi ayam cincang bumbu manis gurih", price: 16000, stock: 50, poEta: "1-2 jam" },
  { id: "ayam-original", name: "Bakso Aci Ayam Original", desc: "Rasa original ayam, cocok untuk yang tidak suka manis", price: 15000, stock: 50, poEta: "1-2 jam" },
];

const STATUS_FLOW = ["Masuk", "Diproses", "Selesai"];

const DEFAULT_OPEN_HOUR = 8; // 08.00 WIB
const DEFAULT_CLOSE_HOUR = 19; // 19.00 WIB

const PAYMENT_METHODS = [
  { id: "seabank", label: "SeaBank" },
  { id: "dana", label: "DANA" },
  { id: "gopay", label: "GoPay" },
  { id: "shopeepay", label: "ShopeePay" },
];

function getWibNow() {
  // Selalu hitung berdasarkan waktu WIB (UTC+7), terlepas dari timezone device
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 7 * 60 * 60000);
}

function isStoreOpen(openHour = DEFAULT_OPEN_HOUR, closeHour = DEFAULT_CLOSE_HOUR) {
  const wib = getWibNow();
  const hour = wib.getHours();
  return hour >= openHour && hour < closeHour;
}

function rupiah(n) {
  return "Rp" + n.toLocaleString("id-ID");
}

export default function BasoAciApp() {
  const [view, setView] = useState("order"); // order | admin
  const [menu, setMenu] = useState(DEFAULT_MENU);
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [cart, setCart] = useState({});
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerAddr, setBuyerAddr] = useState("");
  const [deliveryArea, setDeliveryArea] = useState("dalam-kota");
  const [inCityExpedition, setInCityExpedition] = useState("GoSend");
  const [paymentMethod, setPaymentMethod] = useState("seabank");
  const [lastOrderId, setLastOrderId] = useState(null);
  const [toast, setToast] = useState("");
  const [isAdminAuthed, setIsAdminAuthed] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pendingScrollId, setPendingScrollId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [shopInfo, setShopInfo] = useState({
    name: "Bakso Aci SINDHEL_official",
    phone: "",
    address: "",
    openHour: DEFAULT_OPEN_HOUR,
    closeHour: DEFAULT_CLOSE_HOUR,
    paymentAccounts: { seabank: "", dana: "", gopay: "", shopeepay: "" },
  });
  const [testimonials, setTestimonials] = useState([]);
  const [logoTapCount, setLogoTapCount] = useState(0);
  const logoTapTimer = useRef(null);
  const [storeOpen, setStoreOpen] = useState(isStoreOpen());

  useEffect(() => {
    const openHour = Number(shopInfo.openHour ?? DEFAULT_OPEN_HOUR);
    const closeHour = Number(shopInfo.closeHour ?? DEFAULT_CLOSE_HOUR);
    setStoreOpen(isStoreOpen(openHour, closeHour));
    const interval = setInterval(() => setStoreOpen(isStoreOpen(openHour, closeHour)), 30000);
    return () => clearInterval(interval);
  }, [shopInfo.openHour, shopInfo.closeHour]);

  function handleLogoTap() {
    setLogoTapCount((prev) => {
      const next = prev + 1;
      if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
      if (next >= 5) {
        setView("admin");
        logoTapTimer.current = null;
        return 0;
      }
      logoTapTimer.current = setTimeout(() => setLogoTapCount(0), 1500);
      return next;
    });
  }

  // ---------- Load from backend (Cloudflare Worker + D1) ----------
  const refreshMenu = useCallback(async () => {
    try {
      const { menu: m } = await api.getMenu();
      setMenu(m);
    } catch (e) {}
  }, []);

  const refreshShopInfo = useCallback(async () => {
    try {
      const { shopInfo: s } = await api.getShopInfo();
      setShopInfo(s);
    } catch (e) {}
  }, []);

  const refreshTestimonials = useCallback(async () => {
    try {
      const { testimonials: t } = await api.getTestimonials();
      setTestimonials(t);
    } catch (e) {}
  }, []);

  // Admin-only: full order list requires a valid session token
  const refreshOrders = useCallback(async () => {
    if (!isAdminAuthed) return;
    try {
      const { orders: o } = await api.listOrders();
      setOrders(o);
    } catch (e) {
      if (e.status === 401) {
        setIsAdminAuthed(false);
        setAdminToken(null);
      }
    }
  }, [isAdminAuthed]);

  useEffect(() => {
    (async () => {
      await Promise.all([refreshMenu(), refreshShopInfo(), refreshTestimonials()]);
      setLoaded(true);

      // Kalau ada token admin tersimpan dari sesi sebelumnya, coba pakai lagi
      if (localStorage.getItem("basoaci_admin_token")) {
        setIsAdminAuthed(true);
      }

      // Check if URL hash points to a specific order (simulating the "auto-copy" link from WhatsApp)
      const hash = window.location.hash;
      if (hash.startsWith("#admin")) setView("admin");
      if (hash.includes("order=")) {
        const id = hash.split("order=")[1]?.split("&")[0];
        const action = hash.includes("action=process") ? "process" : null;
        if (id) {
          setView("admin");
          setPendingScrollId(id);
          setPendingAction(action);
        }
      }
    })();
  }, []);

  // Setelah admin login/token siap, muat daftar order, lalu poll berkala
  // supaya perubahan dari Telegram (status/batalkan) ikut muncul di web admin.
  useEffect(() => {
    if (!isAdminAuthed) return;
    refreshOrders();
    const interval = setInterval(refreshOrders, 10000);
    return () => clearInterval(interval);
  }, [isAdminAuthed, refreshOrders]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  // ---------- Cart logic ----------
  const openHour = Number(shopInfo.openHour ?? DEFAULT_OPEN_HOUR);
  const closeHour = Number(shopInfo.closeHour ?? DEFAULT_CLOSE_HOUR);

  function changeQty(id, delta) {
    if (delta > 0 && !storeOpen) {
      showToast(`Pemesanan hanya dibuka pukul ${openHour}.00–${closeHour}.00 WIB.`);
      return;
    }
    setCart((prev) => {
      const next = { ...prev };
      const q = (next[id] || 0) + delta;
      const item = menu.find((m) => m.id === id);
      const stock = item?.stock ?? 0;
      // Jika stok tersedia (bukan PO), batasi qty maksimal sesuai stok
      if (delta > 0 && stock > 0 && q > stock) {
        showToast(`Stok ${item.name} tinggal ${stock}.`);
        return prev;
      }
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });
  }

  const cartItems = Object.entries(cart)
    .map(([id, qty]) => ({ ...menu.find((m) => m.id === id), qty }))
    .filter((i) => i.id);
  const total = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const itemCount = cartItems.reduce((sum, i) => sum + i.qty, 0);

  // ---------- Submit order ----------
  const [pendingOrder, setPendingOrder] = useState(null);

  function submitOrder() {
    if (!isStoreOpen(openHour, closeHour)) return showToast(`Pemesanan sedang tutup. Buka kembali pukul ${openHour}.00 WIB.`);
    if (cartItems.length === 0) return showToast("Pilih menu dulu, ya.");
    if (!buyerName.trim()) return showToast("Isi nama kamu dulu.");
    if (!buyerPhone.trim()) return showToast("Isi nomor HP kamu dulu.");
    if (!buyerAddr.trim()) return showToast("Isi alamat/lokasi pengiriman.");

    const hasPo = cartItems.some((i) => (i.stock ?? 0) <= 0);
    const paymentLabel = PAYMENT_METHODS.find((p) => p.id === paymentMethod)?.label || paymentMethod;
    const draftOrder = {
      // id belum ada — baru dibuat server saat pembeli konfirmasi sudah kirim WA
      items: cartItems.map((i) => ({ id: i.id, name: i.name, qty: i.qty, price: i.price, isPo: (i.stock ?? 0) <= 0, poEta: i.poEta || null })),
      total,
      isPo: hasPo,
      buyerName: buyerName.trim(),
      buyerPhone: buyerPhone.trim(),
      buyerAddr: buyerAddr.trim(),
      deliveryArea,
      expedition: deliveryArea === "dalam-kota" ? inCityExpedition : "J&T",
      paymentMethod,
    };

    const areaLabel = deliveryArea === "dalam-kota" ? "Dalam Kota" : "Luar Kota";
    const expedition = draftOrder.expedition;
    const lines = [
      `*PESANAN BAKSO ACI BARU*${hasPo ? " (Ada item PO)" : ""}`,
      ``,
      ...cartItems.flatMap((i) => [
        `• ${i.name}${(i.stock ?? 0) <= 0 ? ` (PO, est. ${i.poEta || "1-2 jam"})` : ""}`,
        `  Jumlah: ${i.qty} pcs`,
        `  Harga satuan: ${rupiah(i.price)}`,
        `  Subtotal: ${rupiah(i.price * i.qty)}`,
        ``,
      ]),
      `Total: *${rupiah(total)}* (belum termasuk ongkos kirim)`,
      ``,
      `Nama: ${draftOrder.buyerName}`,
      `No. HP: ${draftOrder.buyerPhone}`,
      `Area: ${areaLabel} (${expedition})`,
      `Alamat: ${draftOrder.buyerAddr}`,
      ``,
      `Metode Bayar: *${paymentLabel}*`,
      ``,
      `⚠️ Admin: mohon cek nomor WA pengirim pesan ini cocok dengan No. HP di atas sebelum diproses.`,
    ].filter(Boolean);

    const waText = encodeURIComponent(lines.join("\n"));
    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`;

    // Pesanan belum disimpan ke server di sini — hanya draft menunggu konfirmasi pembeli
    setPendingOrder(draftOrder);
    window.open(waUrl, "_blank");
  }

  async function confirmOrderSent() {
    if (!pendingOrder) return;
    try {
      const { order } = await api.createOrder(pendingOrder);
      setLastOrderId(order.id);
      setPendingOrder(null);
      setCart({});
      setBuyerName("");
      setBuyerPhone("");
      setBuyerAddr("");
    } catch (e) {
      showToast(e.message || "Gagal menyimpan pesanan. Coba lagi.");
    }
  }

  function cancelPendingOrder() {
    setPendingOrder(null);
  }

  // Catatan: pengurangan/pengembalian stok saat status berubah sekarang
  // ditangani otomatis oleh backend (Worker), termasuk saat diubah dari bot Telegram.
  async function updateStatus(orderId, status) {
    try {
      await api.updateOrderStatus(orderId, status);
      await Promise.all([refreshOrders(), refreshMenu()]);
    } catch (e) {
      showToast(e.message || "Gagal mengubah status pesanan.");
    }
  }

  async function cancelOrder(orderId, reason, notifyBuyer) {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status === "Dibatalkan") return;

    try {
      await api.cancelOrder(orderId, reason);
      await Promise.all([refreshOrders(), refreshMenu()]);
      showToast(`Pesanan ${orderId} dibatalkan.`);
    } catch (e) {
      showToast(e.message || "Gagal membatalkan pesanan.");
      return;
    }

    if (notifyBuyer) {
      let buyerDigits = (order.buyerPhone || "").replace(/\D/g, "");
      if (buyerDigits.startsWith("0")) buyerDigits = "62" + buyerDigits.slice(1);
      if (buyerDigits && !buyerDigits.startsWith("62")) buyerDigits = "62" + buyerDigits;

      if (buyerDigits.length < 8) {
        showToast("Nomor HP pembeli tidak valid, pesan pembatalan tidak bisa dikirim via WA.");
      } else {
        const lines = [
          `*PESANAN DIBATALKAN*`,
          `No. Pesanan: ${orderId}`,
          ``,
          `Halo ${order.buyerName || ""}, pesananmu terpaksa kami batalkan.`,
          reason ? `Alasan: ${reason}` : null,
          ``,
          `Kalau ada pertanyaan, langsung balas pesan ini ya. Mohon maaf atas ketidaknyamanannya.`,
        ].filter(Boolean);
        const waText = encodeURIComponent(lines.join("\n"));
        window.open(`https://wa.me/${buyerDigits}?text=${waText}`, "_blank");
      }
    }
  }

  async function updatePrice(id, price) {
    try {
      await api.updateMenuItem(id, { price: Number(price) || 0 });
      await refreshMenu();
    } catch (e) {
      showToast(e.message || "Gagal mengubah harga.");
    }
  }

  async function updateDesc(id, desc) {
    try {
      await api.updateMenuItem(id, { desc });
      await refreshMenu();
    } catch (e) {
      showToast(e.message || "Gagal mengubah deskripsi.");
    }
  }

  async function updateStock(id, stock) {
    try {
      await api.updateMenuItem(id, { stock: Math.max(0, Number(stock) || 0) });
      await refreshMenu();
    } catch (e) {
      showToast(e.message || "Gagal mengubah stok.");
    }
  }

  async function updatePoEta(id, poEta) {
    try {
      await api.updateMenuItem(id, { poEta });
      await refreshMenu();
    } catch (e) {
      showToast(e.message || "Gagal mengubah estimasi PO.");
    }
  }

  async function addMenuItem(item) {
    try {
      await api.createMenuItem({
        name: item.name.trim(),
        desc: item.desc.trim(),
        price: Number(item.price) || 0,
        stock: Number(item.stock) || 0,
        poEta: "1-2 jam",
      });
      await refreshMenu();
    } catch (e) {
      showToast(e.message || "Gagal menambah menu.");
    }
  }

  async function deleteMenuItem(id) {
    try {
      await api.deleteMenuItem(id);
      await refreshMenu();
    } catch (e) {
      showToast(e.message || "Gagal menghapus menu.");
    }
  }

  async function updateShippingCost(orderId, shippingCost) {
    try {
      await api.updateShippingCost(orderId, Math.max(0, Number(shippingCost) || 0));
      await refreshOrders();
    } catch (e) {
      showToast(e.message || "Gagal mengubah ongkir.");
    }
  }

  async function saveShopInfo(next) {
    try {
      await api.updateShopInfo(next);
      await refreshShopInfo();
      return true;
    } catch (e) {
      showToast(e.message || "Gagal menyimpan data toko.");
      return false;
    }
  }

  // ---------- Testimonials ----------
  async function submitTestimonial({ phone, name, rating, comment }) {
    try {
      await api.createTestimonial({ phone: phone.trim(), name: name.trim() || "Pelanggan", rating, comment: comment.trim() });
      await refreshTestimonials();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message || "Gagal mengirim testimoni." };
    }
  }

  async function setTestimonialStatus(id, status) {
    try {
      await api.setTestimonialStatus(id, status);
      await refreshTestimonials();
    } catch (e) {
      showToast(e.message || "Gagal mengubah status testimoni.");
    }
  }

  async function checkPin() {
    try {
      const { token } = await api.login(pinInput);
      setAdminToken(token);
      setIsAdminAuthed(true);
      setPinError(false);
      setPinInput("");
      if (pendingAction === "process" && pendingScrollId) {
        await updateStatus(pendingScrollId, "Diproses");
        showToast(`Pesanan ${pendingScrollId} ditandai Diproses.`);
      }
      if (pendingScrollId) {
        setTimeout(() => {
          const el = document.getElementById("order-" + pendingScrollId);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          setPendingScrollId(null);
          setPendingAction(null);
        }, 300);
      }
    } catch (e) {
      setPinError(true);
      setPinInput("");
    }
  }

  async function logoutAdmin() {
    try {
      await api.logout();
    } catch (e) {}
    setAdminToken(null);
    setIsAdminAuthed(false);
    setView("order");
  }

  function sendLabelToWhatsApp(order) {
    const shippingCost = order.shippingCost || 0;
    const paymentLabel = PAYMENT_METHODS.find((p) => p.id === order.paymentMethod)?.label || order.paymentMethod || "-";
    const paymentAccount = shopInfo.paymentAccounts?.[order.paymentMethod] || "";
    const itemLinesWa = order.items.map((i) => `- ${i.name} x${i.qty}`).join("\n");
    const waLines = [
      `*LABEL PENGIRIMAN*`,
      `No. Pesanan: ${order.id}`,
      ``,
      `Pengirim:`,
      `${shopInfo.name || "-"}`,
      `${shopInfo.phone || "-"}`,
      `${shopInfo.address || "-"}`,
      ``,
      `Penerima:`,
      `${order.buyerName}`,
      `${order.buyerPhone || "-"}`,
      `${order.buyerAddr}`,
      ``,
      `Isi:`,
      itemLinesWa,
      ``,
      `Subtotal: ${rupiah(order.total)}`,
      `Ongkir: ${shippingCost > 0 ? rupiah(shippingCost) : "-"}`,
      `Total bayar: *${rupiah(order.total + shippingCost)}*`,
      ``,
      `Metode Bayar: *${paymentLabel}*${paymentAccount ? `\nNo. Tujuan: ${paymentAccount}` : ""}`,
    ];

    // Bersihkan nomor pembeli: hilangkan karakter non-digit, ubah awalan 0 jadi 62
    let buyerDigits = (order.buyerPhone || "").replace(/\D/g, "");
    if (buyerDigits.startsWith("0")) buyerDigits = "62" + buyerDigits.slice(1);
    if (!buyerDigits.startsWith("62")) buyerDigits = "62" + buyerDigits;

    if (buyerDigits.length < 8) {
      showToast("Nomor HP pembeli tidak valid, label tidak bisa dikirim via WA.");
      return;
    }

    // Batas aman panjang pesan: order dengan banyak item bisa menghasilkan URL
    // wa.me yang sangat panjang, dan beberapa browser diam-diam gagal membuka
    // tab baru kalau URL kepanjangan (tombol terlihat seperti tidak bereaksi).
    // Kalau kepanjangan, kirim versi ringkas saja.
    const MAX_WA_TEXT_LENGTH = 1500;
    let fullText = waLines.join("\n");
    if (fullText.length > MAX_WA_TEXT_LENGTH) {
      fullText = [
        `*LABEL PENGIRIMAN*`,
        `No. Pesanan: ${order.id}`,
        ``,
        `Penerima: ${order.buyerName} (${order.buyerPhone || "-"})`,
        `${order.buyerAddr}`,
        ``,
        `Isi:`,
        itemLinesWa,
        ``,
        `Total bayar: *${rupiah(order.total + shippingCost)}*`,
        `Metode Bayar: *${paymentLabel}*${paymentAccount ? ` (${paymentAccount})` : ""}`,
        ``,
        `(Rincian lengkap ada di label cetak/admin)`,
      ].join("\n");
    }

    const waText = encodeURIComponent(fullText);
    const waUrl = `https://wa.me/${buyerDigits}?text=${waText}`;
    const opened = window.open(waUrl, "_blank");

    // Jika popup diblokir browser, beri fallback jelas supaya tombol tidak
    // terkesan "mati" tanpa penjelasan.
    if (!opened) {
      showToast("Popup diblokir browser. Coba klik lagi atau izinkan popup untuk situs ini.");
      try {
        const a = document.createElement("a");
        a.href = waUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {}
    }
  }

  function printLabel(ordersToPrint, paperSize) {
    const list = Array.isArray(ordersToPrint) ? ordersToPrint : [ordersToPrint];
    if (list.length === 0) return showToast("Pilih minimal satu pesanan untuk dicetak.");

    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) return showToast("Izinkan pop-up untuk mencetak label.");

    const labelHtml = (order) => `
      <div class="label-card">
        <div class="row">
          <div class="label">Pengirim: ${shopInfo.name || "-"}</div>
          <div class="value">${shopInfo.phone || "-"}</div>
          <div class="value">${shopInfo.address || "-"}</div>
        </div>
        <hr />
        <div class="row">
          <div class="label">Penerima</div>
          <div class="value">${order.buyerName}</div>
          <div class="value">${order.buyerPhone || "-"}</div>
          <div class="value">${order.buyerAddr}</div>
        </div>
      </div>
    `;

    let pageStyle = "";
    let gridStyle = "";

    if (paperSize === "a4") {
      // Grid 2 kolom x 4 baris per halaman A4
      pageStyle = `@page { size: A4; margin: 10mm; }`;
      gridStyle = `
        .sheet { display: grid; grid-template-columns: repeat(2, 1fr); grid-auto-rows: 65mm; gap: 6mm; }
        .label-card { border: 1px dashed #999; padding: 8px; page-break-inside: avoid; }
      `;
    } else if (paperSize === "a3") {
      // Grid 3 kolom x 4 baris per halaman A3 (lebih besar, lebih banyak muat)
      pageStyle = `@page { size: A3; margin: 10mm; }`;
      gridStyle = `
        .sheet { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 70mm; gap: 6mm; }
        .label-card { border: 1px dashed #999; padding: 10px; page-break-inside: avoid; }
      `;
    } else {
      // Thermal: satu label per "halaman" 100mm x 100mm, berurutan
      pageStyle = `@page { size: 100mm 100mm; margin: 4mm; }`;
      gridStyle = `
        .sheet { display: block; }
        .label-card { width: 100%; box-sizing: border-box; page-break-after: always; }
        .label-card:last-child { page-break-after: auto; }
      `;
    }

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Label Pengiriman (${list.length})</title>
        <style>
          ${pageStyle}
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #000; margin: 0; }
          .label { font-weight: bold; text-transform: uppercase; }
          .value { margin-top: 2px; line-height: 1.4; }
          .value + .value { margin-top: 5px; }
          hr { border: none; border-top: 1.5px solid #000; margin: 10px 0; }
          .row { margin-bottom: 10px; }
          ${gridStyle}
        </style>
      </head>
      <body onload="window.print()">
        <div class="sheet">
          ${list.map(labelHtml).join("")}
        </div>
      </body>
      </html>
    `);
    win.document.close();
  }

  // ---------- Derived stats for admin ----------
  const todayStr = new Date().toDateString();
  const todayOrders = orders.filter((o) => new Date(o.createdAt).toDateString() === todayStr);
  const todayRevenue = todayOrders.reduce((s, o) => s + o.total, 0);
  const pendingCount = orders.filter((o) => o.status !== "Selesai").length;

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1C1512]">
        <div className="flex flex-col items-center gap-3 text-[#F5E6C8]">
          <ChefHat className="animate-pulse" size={32} />
          <span className="text-sm tracking-wide">Menyiapkan warung...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1C1512] font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');
        .font-display { font-family: 'Archivo Black', sans-serif; }
        .font-sans { font-family: 'Archivo', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .steam { animation: steam 3s ease-in-out infinite; }
        @keyframes steam {
          0%, 100% { transform: translateY(0) scaleY(1); opacity: 0.5; }
          50% { transform: translateY(-8px) scaleY(1.1); opacity: 0.15; }
        }
        @media (prefers-reduced-motion: reduce) {
          .steam { animation: none; }
        }
      `}</style>

      {/* Top nav toggle */}
      <div className="sticky top-0 z-40 bg-[#1C1512]/95 backdrop-blur border-b border-[#F5E6C8]/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 select-none cursor-pointer" onClick={handleLogoTap}>
            <Flame size={20} className="text-[#E85D2C]" />
            <span className="font-display text-[#F5E6C8] text-sm tracking-wide">BASO ACI</span>
          </div>
          <div className="flex gap-1 bg-[#F5E6C8]/5 rounded-full p-1">
            <button
              onClick={() => setView("order")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] ${
                view === "order" ? "bg-[#E85D2C] text-[#1C1512]" : "text-[#F5E6C8]/60 hover:text-[#F5E6C8]"
              }`}
            >
              Pesan
            </button>
            <button
              onClick={() => setView("testimoni")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] flex items-center gap-1 ${
                view === "testimoni" ? "bg-[#E85D2C] text-[#1C1512]" : "text-[#F5E6C8]/60 hover:text-[#F5E6C8]"
              }`}
            >
              <MessageSquareHeart size={12} /> Testimoni
            </button>
            <button
              onClick={() => setView("riwayat")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] flex items-center gap-1 ${
                view === "riwayat" ? "bg-[#E85D2C] text-[#1C1512]" : "text-[#F5E6C8]/60 hover:text-[#F5E6C8]"
              }`}
            >
              <ClipboardList size={12} /> Riwayat
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#F5E6C8] text-[#1C1512] px-4 py-2 rounded-lg text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}

      {view === "order" ? (
        <OrderView
          menu={menu}
          cart={cart}
          changeQty={changeQty}
          cartItems={cartItems}
          total={total}
          itemCount={itemCount}
          buyerName={buyerName}
          setBuyerName={setBuyerName}
          buyerPhone={buyerPhone}
          setBuyerPhone={setBuyerPhone}
          buyerAddr={buyerAddr}
          setBuyerAddr={setBuyerAddr}
          deliveryArea={deliveryArea}
          setDeliveryArea={setDeliveryArea}
          inCityExpedition={inCityExpedition}
          setInCityExpedition={setInCityExpedition}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          shopInfo={shopInfo}
          submitOrder={submitOrder}
          lastOrderId={lastOrderId}
          pendingOrder={pendingOrder}
          confirmOrderSent={confirmOrderSent}
          cancelPendingOrder={cancelPendingOrder}
          storeOpen={storeOpen}
          openHour={openHour}
          closeHour={closeHour}
        />
      ) : view === "testimoni" ? (
        <TestimonialView submitTestimonial={submitTestimonial} testimonials={testimonials} />
      ) : view === "riwayat" ? (
        <HistoryView cancelOrder={cancelOrder} />
      ) : !isAdminAuthed ? (
        <AdminGate
          pinInput={pinInput}
          setPinInput={setPinInput}
          pinError={pinError}
          checkPin={checkPin}
        />
      ) : (
        <AdminView
          menu={menu}
          orders={orders}
          updateStatus={updateStatus}
          cancelOrder={cancelOrder}
          updatePrice={updatePrice}
          updateDesc={updateDesc}
          updateStock={updateStock}
          updatePoEta={updatePoEta}
          addMenuItem={addMenuItem}
          deleteMenuItem={deleteMenuItem}
          updateShippingCost={updateShippingCost}
          todayOrders={todayOrders}
          todayRevenue={todayRevenue}
          pendingCount={pendingCount}
          logoutAdmin={logoutAdmin}
          shopInfo={shopInfo}
          saveShopInfo={saveShopInfo}
          printLabel={printLabel}
          sendLabelToWhatsApp={sendLabelToWhatsApp}
          testimonials={testimonials}
          setTestimonialStatus={setTestimonialStatus}
        />
      )}
    </div>
  );
}

// ============= ORDER VIEW =============
function OrderView({
  menu, cart, changeQty, cartItems, total, itemCount,
  buyerName, setBuyerName, buyerPhone, setBuyerPhone, buyerAddr, setBuyerAddr,
  deliveryArea, setDeliveryArea,
  inCityExpedition, setInCityExpedition,
  paymentMethod, setPaymentMethod, shopInfo,
  submitOrder, lastOrderId,
  pendingOrder, confirmOrderSent, cancelPendingOrder,
  storeOpen, openHour, closeHour,
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [buyerOrderHistory, setBuyerOrderHistory] = useState([]);
  const buyerInfoRef = useRef(null);
  const prevItemCount = useRef(itemCount);

  useEffect(() => {
    if (prevItemCount.current === 0 && itemCount > 0) {
      const t = setTimeout(() => {
        buyerInfoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      prevItemCount.current = itemCount;
      return () => clearTimeout(t);
    }
    prevItemCount.current = itemCount;
  }, [itemCount]);

  // Ambil riwayat pesanan pembeli saat nomor HP-nya valid (di-debounce biar tidak spam API)
  useEffect(() => {
    const digits = (buyerPhone || "").replace(/\D/g, "");
    if (digits.length < 8) {
      setBuyerOrderHistory([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { orders } = await api.getOrdersByPhone(buyerPhone);
        setBuyerOrderHistory(orders);
      } catch (e) {
        setBuyerOrderHistory([]);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [buyerPhone]);

  return (
    <div className="max-w-5xl mx-auto px-4 pb-32">
      {/* Hero */}
      <div className="relative pt-10 pb-8 text-center">
        <div className="relative inline-block">
          <div className="steam absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-[#F5E6C8]/30 rounded-full blur-md" />
          <span className="text-5xl relative">🍲</span>
        </div>
        <h1 className="font-display text-[#F5E6C8] text-3xl md:text-4xl mt-4 leading-tight">
          BASO ACI SINDHEL
        </h1>
        <p className="text-[#E85D2C] font-mono text-xs tracking-[0.2em] mt-1 uppercase">
          Panas · Gurih · Nampol
        </p>
      </div>

      {/* Info PO */}
      <p className="text-center text-[#F5E6C8] font-bold text-sm mb-1">
        Jika stok habis, maka akan di alihkan ke PO dengan estimasi 1 hari
      </p>
      <p className="text-center text-[#F5E6C8]/60 text-xs mb-4">
        Setiap menu dapat sambal terpisah
      </p>

      {/* Riwayat pesanan */}
      {buyerOrderHistory && buyerOrderHistory.length > 0 && (
        <div className="mb-5 rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 px-4 py-3">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="text-[#E85D2C] text-[11px] font-semibold hover:underline"
          >
            {showHistory ? "Sembunyikan" : "Lihat"} riwayat pesanan ({buyerOrderHistory.length})
          </button>
        </div>
      )}

      {showHistory && buyerOrderHistory && buyerOrderHistory.length > 0 && (
        <div className="grid gap-2 mb-5">
          {buyerOrderHistory.map((o) => (
            <div key={o.id} className="rounded-xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[#F5E6C8]/70 text-xs">{o.id}</span>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#4A7C59]/20 text-[#4A7C59]">{o.status}</span>
              </div>
              <p className="text-[#F5E6C8]/50 text-[11px] mt-1">
                {o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
              </p>
              <p className="text-[#E85D2C] font-mono text-xs mt-1 font-semibold">{rupiah(o.total)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Menu list */}
      {!storeOpen && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 mb-3 flex items-center gap-2">
          <Clock size={15} className="text-red-300 shrink-0" />
          <p className="text-red-200 text-xs">
            Pemesanan sedang <span className="font-semibold">tutup</span>. Kami buka setiap hari pukul <span className="font-semibold">{String(openHour).padStart(2, "0")}.00–{String(closeHour).padStart(2, "0")}.00 WIB</span>.
          </p>
        </div>
      )}
      <div className="rounded-xl bg-[#E85D2C]/10 border border-[#E85D2C]/25 px-4 py-2.5 mb-3 flex items-center gap-2">
        <Flame size={14} className="text-[#E85D2C] shrink-0" />
        <p className="text-[#F5E6C8]/80 text-xs">Setiap produk dapat sambal terpisah</p>
      </div>
      <div className="rounded-xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 px-4 py-2.5 mb-3 flex items-center gap-2">
        <ClipboardList size={14} className="text-[#F5E6C8]/50 shrink-0" />
        <p className="text-[#F5E6C8]/60 text-xs">
          Ingin membatalkan pesanan? Masuk ke menu <span className="font-semibold text-[#F5E6C8]">Riwayat</span> dan masukkan no. HP yang sudah kamu input saat memesan.
        </p>
      </div>
      <div className={`grid gap-3 ${!storeOpen ? "opacity-50 pointer-events-none" : ""}`}>
        {menu.map((item) => {
          const qty = cart[item.id] || 0;
          const isPo = (item.stock ?? 0) <= 0;
          return (
            <div
              key={item.id}
              className={`rounded-2xl border p-4 flex items-center gap-4 transition-colors ${
                qty > 0 ? "bg-[#E85D2C]/10 border-[#E85D2C]/50" : isPo ? "bg-[#F5E6C8]/[0.03] border-[#F5E6C8]/10" : "bg-[#F5E6C8]/5 border-[#F5E6C8]/10"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[#F5E6C8] font-semibold text-sm">{item.name}</h3>
                  {item.tag && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-[#4A7C59] text-[#F5E6C8] px-2 py-0.5 rounded-full">
                      {item.tag}
                    </span>
                  )}
                  {isPo && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-[#E85D2C] text-[#1C1512] px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Clock size={9} /> PO
                    </span>
                  )}
                </div>
                <p className="text-[#F5E6C8]/50 text-xs mt-1">{item.desc}</p>
                {isPo && (
                  <p className="text-[#E85D2C]/80 text-[10px] mt-1 flex items-center gap-1">
                    <Clock size={10} /> Pre-order · estimasi siap {item.poEta || "1-2 jam"}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className="font-mono text-[#E85D2C] text-sm font-semibold">{rupiah(item.price)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {qty > 0 && (
                  <button
                    onClick={() => changeQty(item.id, -1)}
                    aria-label={`Kurangi ${item.name}`}
                    className="w-8 h-8 rounded-full bg-[#F5E6C8]/10 text-[#F5E6C8] flex items-center justify-center hover:bg-[#F5E6C8]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
                  >
                    <Minus size={14} />
                  </button>
                )}
                {qty > 0 && <span className="text-[#F5E6C8] font-mono text-sm w-4 text-center">{qty}</span>}
                <button
                  onClick={() => changeQty(item.id, 1)}
                  aria-label={`Tambah ${item.name}`}
                  disabled={!isPo && qty >= (item.stock ?? 0)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8] ${
                    !isPo && qty >= (item.stock ?? 0)
                      ? "bg-[#F5E6C8]/10 text-[#F5E6C8]/30 cursor-not-allowed"
                      : "bg-[#E85D2C] text-[#1C1512] hover:bg-[#E85D2C]/80"
                  }`}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Buyer info */}
      {itemCount > 0 && (
        <div ref={buyerInfoRef} className="mt-8 rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4 grid gap-3">
          <h3 className="text-[#F5E6C8] font-semibold text-sm flex items-center gap-2">
            <ShoppingBag size={15} className="text-[#E85D2C]" /> Data Pemesan
          </h3>
          <input
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Nama kamu"
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
          />
          <input
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            placeholder="No. WhatsApp aktif kamu"
            type="tel"
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
          />
          <p className="text-[#F5E6C8]/40 text-[11px] -mt-2">
            Wajib pakai nomor WhatsApp milikmu sendiri, sesuai HP yang kamu pakai untuk kirim pesan konfirmasi nanti. Pesanan dari nomor yang tidak cocok berisiko ditolak admin.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryArea("dalam-kota")}
              style={{
                backgroundColor: deliveryArea === "dalam-kota" ? "#1C1512" : "#F5E6C8",
                color: deliveryArea === "dalam-kota" ? "#F5E6C8" : "#1C1512",
                border: "2px solid #F5E6C8",
              }}
              className="text-sm font-semibold py-2.5 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
            >
              Dalam Kota
            </button>
            <button
              type="button"
              onClick={() => setDeliveryArea("luar-kota")}
              style={{
                backgroundColor: deliveryArea === "luar-kota" ? "#1C1512" : "#F5E6C8",
                color: deliveryArea === "luar-kota" ? "#F5E6C8" : "#1C1512",
                border: "2px solid #F5E6C8",
              }}
              className="text-sm font-semibold py-2.5 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
            >
              Luar Kota
            </button>
          </div>
          {deliveryArea === "dalam-kota" ? (
            <div className="grid gap-1.5">
              <p className="text-[#F5E6C8]/50 text-xs">Pilih ekspedisi</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setInCityExpedition("GoSend")}
                  style={{
                    backgroundColor: inCityExpedition === "GoSend" ? "#E85D2C" : "#F5E6C8",
                    color: "#1C1512",
                    border: "2px solid #E85D2C",
                  }}
                  className="text-sm font-semibold py-2 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8]"
                >
                  GoSend
                </button>
                <button
                  type="button"
                  onClick={() => setInCityExpedition("Shopee Instan")}
                  style={{
                    backgroundColor: inCityExpedition === "Shopee Instan" ? "#E85D2C" : "#F5E6C8",
                    color: "#1C1512",
                    border: "2px solid #E85D2C",
                  }}
                  className="text-sm font-semibold py-2 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8]"
                >
                  Shopee Instan
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[#F5E6C8]/50 text-xs -mt-1">
              Ekspedisi: <span className="text-[#E85D2C] font-semibold">J&T</span>
            </p>
          )}
          <textarea
            value={buyerAddr}
            onChange={(e) => setBuyerAddr(e.target.value)}
            placeholder="Alamat pengiriman"
            rows={2}
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none resize-none"
          />

          <div className="grid gap-1.5 mt-1">
            <p className="text-[#F5E6C8]/50 text-xs">Metode pembayaran</p>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id)}
                  style={{
                    backgroundColor: paymentMethod === m.id ? "#E85D2C" : "#F5E6C8",
                    color: "#1C1512",
                    border: "2px solid #E85D2C",
                  }}
                  className="text-sm font-semibold py-2 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8]"
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[#F5E6C8]/40 text-[11px] mt-0.5">
              No. rekening/tujuan pembayaran akan dikirim admin via WhatsApp setelah pesan kamu dibaca admin.
            </p>
          </div>
        </div>
      )}

      {lastOrderId && itemCount === 0 && !pendingOrder && (
        <div className="mt-6 rounded-2xl bg-[#4A7C59]/15 border border-[#4A7C59]/40 p-4 text-center">
          <p className="text-[#F5E6C8] text-sm font-semibold">Pesanan terkirim ke WhatsApp admin.</p>
          <p className="text-[#F5E6C8]/60 text-xs mt-1 font-mono">No. Pesanan: {lastOrderId}</p>
        </div>
      )}

      {/* Overlay konfirmasi: tunggu pembeli benar-benar kirim pesan WA */}
      {pendingOrder && (
        <div className="fixed inset-0 z-50 bg-[#1C1512]/90 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="bg-[#1C1512] border border-[#F5E6C8]/15 rounded-2xl p-6 max-w-sm w-full text-center">
            <MessageCircle size={32} className="text-[#4A7C59] mx-auto mb-3" />
            <h3 className="text-[#F5E6C8] font-semibold text-base">Sudah kirim pesan WhatsApp-nya?</h3>
            <p className="text-[#F5E6C8]/60 text-xs mt-2 leading-relaxed">
              Tab WhatsApp sudah kami buka dengan detail pesananmu. Pastikan pesan sudah benar-benar terkirim ke admin, lalu tekan tombol di bawah.
            </p>
            <p className="text-yellow-400/80 text-[11px] mt-2 leading-relaxed">
              Kirim pesan dari WhatsApp dengan nomor yang sama seperti yang kamu isi di form ({buyerPhone || "-"}). Pesanan dari nomor berbeda bisa ditolak admin.
            </p>
            <p className="text-[#F5E6C8]/40 text-[10px] mt-2 font-mono">No. Pesanan: {pendingOrder.id}</p>
            <div className="grid gap-2 mt-5">
              <button
                onClick={confirmOrderSent}
                className="bg-[#E85D2C] text-[#1C1512] font-semibold text-sm py-2.5 rounded-xl hover:bg-[#E85D2C]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8] flex items-center justify-center gap-2"
              >
                <Check size={15} /> Ya, sudah saya kirim
              </button>
              <button
                onClick={cancelPendingOrder}
                className="text-[#F5E6C8]/50 text-xs py-2 hover:text-[#F5E6C8]"
              >
                Belum, batalkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky checkout bar */}
      {itemCount > 0 && !pendingOrder && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#1C1512] border-t border-[#F5E6C8]/10 px-4 py-3">
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <div className="flex-1">
              <p className="text-[#F5E6C8]/50 text-[10px] uppercase tracking-wide flex items-center gap-1.5">
                {itemCount} item
                {cartItems.some((i) => (i.stock ?? 0) <= 0) && (
                  <span className="bg-[#E85D2C] text-[#1C1512] px-1.5 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-0.5">
                    <Clock size={9} /> ada PO
                  </span>
                )}
              </p>
              <p className="text-[#F5E6C8] font-mono font-bold">{rupiah(total)}</p>
              <p className="text-[#F5E6C8]/40 text-[10px] mt-0.5">Belum termasuk ongkos kirim</p>
            </div>
            <button
              onClick={submitOrder}
              disabled={!storeOpen}
              className="bg-[#E85D2C] text-[#1C1512] font-semibold text-sm px-5 py-3 rounded-xl flex items-center gap-2 hover:bg-[#E85D2C]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MessageCircle size={16} /> {storeOpen ? "Pesan via WhatsApp" : "Tutup"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============= TESTIMONIAL VIEW (PUBLIC) =============
function TestimonialView({ submitTestimonial, testimonials }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const approved = testimonials.filter((t) => t.status === "approved");
  const avgRating = approved.length > 0 ? approved.reduce((s, t) => s + t.rating, 0) / approved.length : 0;

  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!phone.trim()) return setError("Isi No. HP yang sama saat kamu order, ya.");
    if (rating === 0) return setError("Kasih rating dulu, minimal 1 bintang.");
    if (!comment.trim()) return setError("Ceritain pengalaman kamu sedikit, ya.");

    setSubmitting(true);
    const result = await submitTestimonial({ phone, name, rating, comment });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSuccess(true);
    setPhone("");
    setName("");
    setRating(0);
    setComment("");
  }

  if (success) {
    return (
      <div className="max-w-sm mx-auto px-4 pt-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#4A7C59]/15 flex items-center justify-center mx-auto mb-4">
          <Check size={22} className="text-[#4A7C59]" />
        </div>
        <h1 className="font-display text-[#F5E6C8] text-xl mb-1">MAKASIH!</h1>
        <p className="text-[#F5E6C8]/50 text-xs mb-6">
          Testimoni kamu sudah kami terima dan akan ditinjau sebelum tampil.
        </p>
        <button
          onClick={() => setSuccess(false)}
          className="text-[#E85D2C] text-xs font-semibold"
        >
          Kirim testimoni lain
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-10 pb-16">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-[#E85D2C]/15 flex items-center justify-center mx-auto mb-4">
          <MessageSquareHeart size={22} className="text-[#E85D2C]" />
        </div>
        <h1 className="font-display text-[#F5E6C8] text-xl mb-1">CERITAKAN PENGALAMANMU</h1>
        <p className="text-[#F5E6C8]/50 text-xs">
          Testimoni hanya bisa diisi oleh pelanggan yang pernah order. Gunakan No. HP yang sama saat kamu memesan.
        </p>
      </div>

      <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4 grid gap-3">
        <label className="grid gap-1">
          <span className="text-[#F5E6C8]/50 text-xs">No. HP saat order</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            placeholder="0812xxxxxxx"
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[#F5E6C8]/50 text-xs">Nama (opsional, tampil di publik)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama kamu"
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
          />
        </label>
        <div className="grid gap-1">
          <span className="text-[#F5E6C8]/50 text-xs">Rating</span>
          <div className="flex items-center gap-1 -ml-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setRating(i)}
                onMouseEnter={() => setHoverRating(i)}
                onMouseLeave={() => setHoverRating(0)}
                aria-label={`${i} bintang`}
                className="p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] rounded"
              >
                <Star
                  size={26}
                  className={`pointer-events-none ${
                    i <= (hoverRating || rating)
                      ? "text-yellow-400 fill-yellow-400"
                      : "text-[#F5E6C8]/20"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
        <label className="grid gap-1">
          <span className="text-[#F5E6C8]/50 text-xs">Testimoni</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Gimana rasanya, pelayanannya, dll."
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none resize-none"
          />
        </label>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          onClick={handleSubmit}
          className="bg-[#E85D2C] text-[#1C1512] font-semibold text-sm py-3 rounded-xl hover:bg-[#E85D2C]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8]"
        >
          Kirim Testimoni
        </button>
      </div>

      {/* Approved testimonials */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[#F5E6C8] font-semibold text-sm">Kata Pelanggan</h2>
          {approved.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Star size={14} className="text-yellow-400 fill-yellow-400" />
              <span className="text-[#F5E6C8] font-mono text-xs font-semibold">{avgRating.toFixed(1)}</span>
              <span className="text-[#F5E6C8]/40 text-xs">({approved.length})</span>
            </div>
          )}
        </div>

        {approved.length === 0 ? (
          <p className="text-[#F5E6C8]/40 text-xs text-center py-6">Belum ada testimoni yang tampil.</p>
        ) : (
          <div className="grid gap-3">
            {approved.map((t) => (
              <div key={t.id} className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#F5E6C8] font-semibold text-sm">{t.name}</span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        size={12}
                        className={i <= t.rating ? "text-yellow-400 fill-yellow-400" : "text-[#F5E6C8]/20"}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-[#F5E6C8]/60 text-xs mt-2 leading-relaxed">{t.comment}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============= HISTORY VIEW (PUBLIC) =============
function HistoryView({ cancelOrder }) {
  const [phoneInput, setPhoneInput] = useState("");
  const [searchedPhone, setSearchedPhone] = useState(null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch() {
    if (!phoneInput.trim()) return;
    setSearchedPhone(phoneInput.trim());
    setSearching(true);
    try {
      const { orders } = await api.getOrdersByPhone(phoneInput.trim());
      setResults(orders);
    } catch (e) {
      setResults([]);
    }
    setSearching(false);
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-32">
      <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-5 grid gap-3">
        <h3 className="text-[#F5E6C8] font-semibold text-sm flex items-center gap-2">
          <ClipboardList size={15} className="text-[#E85D2C]" /> Cek Riwayat Pesanan
        </h3>
        <p className="text-[#F5E6C8]/50 text-xs -mt-1">
          Masukkan nomor HP yang kamu gunakan saat memesan untuk melihat riwayat pesananmu.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="No. HP, mis. 0812xxxxxxx"
            type="tel"
            className="flex-1 bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={!phoneInput.trim()}
            className="shrink-0 bg-[#E85D2C] text-[#1C1512] font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-[#E85D2C]/85 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cari
          </button>
        </div>
      </div>

      {searchedPhone && (
        <div className="mt-5">
          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#F5E6C8]/15 p-8 text-center">
              <p className="text-[#F5E6C8]/50 text-sm">Belum ada pesanan dengan nomor ini.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-[#F5E6C8]/40 text-xs mb-1">{results.length} pesanan ditemukan</p>
              {results.map((o) => (
                <HistoryOrderCard key={o.id} o={o} cancelOrder={cancelOrder} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryOrderCard({ o, cancelOrder }) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const canCancel = o.status === "Masuk";

  function handleConfirmCancel() {
    cancelOrder(o.id, "Dibatalkan oleh pembeli");
    setShowCancelConfirm(false);
  }

  return (
    <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[#E85D2C] text-xs font-bold">{o.id}</span>
            <StatusBadge status={o.status} />
          </div>
          <p className="text-[#F5E6C8]/40 text-[10px] font-mono mt-1">
            {new Date(o.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <p className="text-[#F5E6C8] font-mono font-bold text-sm">{rupiah(o.total)}</p>
      </div>
      <div className="mt-2 border-t border-[#F5E6C8]/10 pt-2 grid gap-0.5">
        {o.items.map((i, idx) => (
          <p key={idx} className="text-[#F5E6C8]/60 text-xs">
            {i.name} × {i.qty}
            {i.isPo && <span className="text-[#E85D2C] font-semibold"> · PO</span>}
          </p>
        ))}
      </div>
      {o.buyerAddr && <p className="text-[#F5E6C8]/40 text-[11px] mt-2">{o.buyerAddr}</p>}

      {o.status === "Dibatalkan" && o.cancelReason && (
        <p className="text-red-300/70 text-[11px] mt-2">Alasan: {o.cancelReason}</p>
      )}

      {canCancel && (
        showCancelConfirm ? (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3 grid gap-2">
            <p className="text-red-300 text-xs font-semibold">Yakin batalkan pesanan ini?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleConfirmCancel}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/80 text-[#F5E6C8] hover:bg-red-500"
              >
                Ya, batalkan
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full text-[#F5E6C8]/50 hover:text-[#F5E6C8] bg-[#1C1512]"
              >
                Tidak
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="mt-3 text-[11px] font-semibold text-red-400/70 hover:text-red-400 flex items-center gap-1"
          >
            <X size={12} /> Batalkan Pesanan
          </button>
        )
      )}
    </div>
  );
}

// ============= ADMIN GATE (PIN LOCK) =============
function AdminGate({ pinInput, setPinInput, pinError, checkPin }) {
  return (
    <div className="max-w-sm mx-auto px-4 pt-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#E85D2C]/15 flex items-center justify-center mx-auto mb-4">
        <Lock size={22} className="text-[#E85D2C]" />
      </div>
      <h1 className="font-display text-[#F5E6C8] text-xl mb-1">AKSES ADMIN</h1>
      <p className="text-[#F5E6C8]/50 text-xs mb-6">Masukkan kode akses untuk melihat pesanan masuk.</p>
      <input
        type="password"
        value={pinInput}
        onChange={(e) => setPinInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && checkPin()}
        placeholder="Kode akses"
        autoFocus
        className={`w-full bg-[#F5E6C8]/5 text-[#F5E6C8] text-center tracking-widest rounded-xl px-3 py-3 text-sm border outline-none mb-2 ${
          pinError ? "border-red-500/60" : "border-[#F5E6C8]/10 focus:border-[#E85D2C]"
        }`}
      />
      {pinError && <p className="text-red-400 text-xs mb-3">Kode salah. Coba lagi.</p>}
      <button
        onClick={checkPin}
        className="w-full bg-[#E85D2C] text-[#1C1512] font-semibold text-sm py-3 rounded-xl hover:bg-[#E85D2C]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8]"
      >
        Masuk
      </button>
    </div>
  );
}

// ============= ADMIN VIEW =============
function AdminView({ menu, orders, updateStatus, cancelOrder, updatePrice, updateDesc, updateStock, updatePoEta, addMenuItem, deleteMenuItem, updateShippingCost, todayOrders, todayRevenue, pendingCount, logoutAdmin, shopInfo, saveShopInfo, printLabel, sendLabelToWhatsApp, testimonials, setTestimonialStatus }) {
  const [tab, setTab] = useState("orders"); // orders | menu | report | shop | testimoni
  const pendingTestimonials = testimonials.filter((t) => t.status === "pending").length;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="pt-8 pb-4 flex items-start justify-between">
        <div>
          <h1 className="font-display text-[#F5E6C8] text-2xl">DAPUR ADMIN</h1>
          <p className="text-[#F5E6C8]/50 text-xs mt-1">Pantau pesanan masuk dan kelola warung dari sini.</p>
        </div>
        <button
          onClick={logoutAdmin}
          className="text-[#F5E6C8]/50 hover:text-[#F5E6C8] text-xs flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#F5E6C8]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
        >
          <LogOut size={12} /> Keluar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Pesanan hari ini" value={todayOrders.length} icon={<ClipboardList size={16} />} />
        <StatCard label="Omzet hari ini" value={rupiah(todayRevenue)} icon={<TrendingUp size={16} />} small />
        <StatCard label="Belum selesai" value={pendingCount} icon={<Clock size={16} />} accent />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F5E6C8]/5 rounded-full p-1 w-fit mb-5 flex-wrap">
        {[
          { id: "orders", label: "Pesanan", icon: <ClipboardList size={14} /> },
          { id: "menu", label: "Menu & Harga", icon: <Settings2 size={14} /> },
          { id: "report", label: "Rekap", icon: <TrendingUp size={14} /> },
          { id: "testimoni", label: "Testimoni", icon: <MessageSquareHeart size={14} /> },
          { id: "shop", label: "Toko", icon: <Store size={14} /> },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] ${
              tab === t.id ? "bg-[#E85D2C] text-[#1C1512]" : "text-[#F5E6C8]/60 hover:text-[#F5E6C8]"
            }`}
          >
            {t.icon} {t.label}
            {t.id === "testimoni" && pendingTestimonials > 0 && (
              <span className="bg-[#E85D2C] text-[#1C1512] rounded-full text-[10px] w-4 h-4 flex items-center justify-center font-bold">
                {pendingTestimonials}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "orders" && (
        <OrdersTab orders={orders} updateStatus={updateStatus} cancelOrder={cancelOrder} updateShippingCost={updateShippingCost} printLabel={printLabel} sendLabelToWhatsApp={sendLabelToWhatsApp} />
      )}
      {tab === "menu" && <MenuTab menu={menu} updatePrice={updatePrice} updateDesc={updateDesc} updateStock={updateStock} updatePoEta={updatePoEta} addMenuItem={addMenuItem} deleteMenuItem={deleteMenuItem} />}
      {tab === "report" && <ReportTab orders={orders} />}
      {tab === "testimoni" && <TestimonialsTab testimonials={testimonials} setTestimonialStatus={setTestimonialStatus} />}
      {tab === "shop" && <ShopTab shopInfo={shopInfo} saveShopInfo={saveShopInfo} />}
    </div>
  );
}

function StatCard({ label, value, icon, accent, small }) {
  return (
    <div className={`rounded-xl p-3.5 border ${accent && value > 0 ? "bg-[#E85D2C]/10 border-[#E85D2C]/40" : "bg-[#F5E6C8]/5 border-[#F5E6C8]/10"}`}>
      <div className="flex items-center gap-1.5 text-[#F5E6C8]/50 text-[10px] uppercase tracking-wide mb-1">
        {icon} {label}
      </div>
      <p className={`text-[#F5E6C8] font-mono font-bold ${small ? "text-sm" : "text-xl"}`}>{value}</p>
    </div>
  );
}

function OrdersTab({ orders, updateStatus, cancelOrder, updateShippingCost, printLabel, sendLabelToWhatsApp }) {
  const [searchPhone, setSearchPhone] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [showPaperDialog, setShowPaperDialog] = useState(false);

  function normalizeDigits(phone) {
    let digits = (phone || "").replace(/\D/g, "");
    if (digits.startsWith("0")) digits = "62" + digits.slice(1);
    if (digits && !digits.startsWith("62")) digits = "62" + digits;
    return digits;
  }

  const searchDigits = normalizeDigits(searchPhone);
  const filteredOrders = searchDigits
    ? orders.filter((o) => normalizeDigits(o.buyerPhone).includes(searchDigits))
    : orders;

  const selectedOrders = orders.filter((o) => selectedIds.includes(o.id));

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    const allIds = filteredOrders.map((o) => o.id);
    const allSelected = allIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? selectedIds.filter((id) => !allIds.includes(id)) : [...new Set([...selectedIds, ...allIds])]);
  }

  function handlePrintSingle(order) {
    setSelectedIds([order.id]);
    setShowPaperDialog(true);
  }

  function handlePrintSelected() {
    if (selectedIds.length === 0) return;
    setShowPaperDialog(true);
  }

  function handleChoosePaper(paperSize) {
    printLabel(selectedOrders, paperSize);
    setShowPaperDialog(false);
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#F5E6C8]/15 p-10 text-center">
        <p className="text-[#F5E6C8]/50 text-sm">Belum ada pesanan masuk. Pesanan baru akan muncul di sini otomatis.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 rounded-xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 px-3 py-2">
        <Phone size={14} className="text-[#E85D2C] shrink-0" />
        <input
          value={searchPhone}
          onChange={(e) => setSearchPhone(e.target.value)}
          placeholder="Cari riwayat pesanan berdasarkan no. HP..."
          type="tel"
          className="flex-1 bg-transparent text-[#F5E6C8] placeholder-[#F5E6C8]/30 text-sm outline-none"
        />
        {searchPhone && (
          <button
            onClick={() => setSearchPhone("")}
            className="shrink-0 text-[#F5E6C8]/40 hover:text-[#F5E6C8]"
            aria-label="Bersihkan pencarian"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={toggleSelectAll}
          className="text-xs font-semibold text-[#F5E6C8]/60 hover:text-[#F5E6C8] flex items-center gap-1.5"
        >
          <Check size={12} /> {filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.includes(o.id)) ? "Batalkan pilih semua" : "Pilih semua"}
        </button>
        {selectedIds.length > 0 && (
          <button
            onClick={handlePrintSelected}
            className="text-xs font-semibold bg-[#E85D2C] text-[#1C1512] px-3 py-1.5 rounded-full hover:bg-[#E85D2C]/85 flex items-center gap-1.5"
          >
            <Printer size={12} /> Cetak Label Terpilih ({selectedIds.length})
          </button>
        )}
      </div>

      {searchDigits && (
        <p className="text-[#F5E6C8]/40 text-xs -mt-1">{filteredOrders.length} pesanan ditemukan</p>
      )}
      {searchDigits && filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#F5E6C8]/15 p-10 text-center">
          <p className="text-[#F5E6C8]/50 text-sm">Tidak ada pesanan dengan nomor ini.</p>
        </div>
      ) : (
      filteredOrders.map((o) => (
        <OrderCard
          key={o.id}
          o={o}
          updateStatus={updateStatus}
          cancelOrder={cancelOrder}
          updateShippingCost={updateShippingCost}
          printLabel={handlePrintSingle}
          sendLabelToWhatsApp={sendLabelToWhatsApp}
          selected={selectedIds.includes(o.id)}
          onToggleSelect={() => toggleSelect(o.id)}
        />
      ))
      )}

      {showPaperDialog && (
        <PaperSizeDialog
          count={selectedIds.length}
          onChoose={handleChoosePaper}
          onClose={() => setShowPaperDialog(false)}
        />
      )}
    </div>
  );
}

function PaperSizeDialog({ count, onChoose, onClose }) {
  const options = [
    { id: "thermal", label: "Kertas Thermal (Resi)", desc: "100×100mm, satu label per lembar" },
    { id: "a4", label: "Kertas A4", desc: "2 kolom per halaman" },
    { id: "a3", label: "Kertas A3", desc: "3 kolom per halaman" },
  ];
  return (
    <div className="fixed inset-0 z-50 bg-[#1C1512]/90 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-[#1C1512] border border-[#F5E6C8]/15 rounded-2xl p-5 max-w-sm w-full">
        <h3 className="text-[#F5E6C8] font-semibold text-sm mb-1">Pilih ukuran kertas</h3>
        <p className="text-[#F5E6C8]/50 text-xs mb-4">Mencetak {count} label pengiriman.</p>
        <div className="grid gap-2">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onChoose(opt.id)}
              className="text-left rounded-xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 hover:border-[#E85D2C]/50 px-4 py-3 transition-colors"
            >
              <p className="text-[#F5E6C8] text-sm font-semibold">{opt.label}</p>
              <p className="text-[#F5E6C8]/50 text-xs mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full text-center text-[#F5E6C8]/50 text-xs py-2 hover:text-[#F5E6C8]"
        >
          Batal
        </button>
      </div>
    </div>
  );
}

function OrderCard({ o, updateStatus, cancelOrder, updateShippingCost, printLabel, sendLabelToWhatsApp, selected, onToggleSelect }) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [notifyBuyer, setNotifyBuyer] = useState(true);
  const [copiedMismatchMsg, setCopiedMismatchMsg] = useState(false);
  const isCancelled = o.status === "Dibatalkan";
  const isPhoneMismatch = /tidak cocok/i.test(cancelReason);

  function handleConfirmCancel() {
    cancelOrder(o.id, cancelReason.trim(), isPhoneMismatch ? false : notifyBuyer);
    setShowCancelConfirm(false);
    setCancelReason("");
  }

  function copyMismatchMessage() {
    const text = [
      `*PESANAN DIBATALKAN*`,
      `No. Pesanan: ${o.id}`,
      ``,
      `Halo, pesananmu terpaksa kami batalkan karena nomor HP yang tercantum di pesanan (${o.buyerPhone || "-"}) tidak sesuai dengan nomor WhatsApp yang kamu gunakan untuk memesan.`,
      ``,
      `Kalau ini kesalahan, silakan pesan ulang dengan nomor WhatsApp aktifmu sendiri. Mohon maaf atas ketidaknyamanannya.`,
    ].join("\n");

    function fallbackCopy() {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(textarea);
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
    setCopiedMismatchMsg(true);
    setTimeout(() => setCopiedMismatchMsg(false), 2000);
  }

  return (
        <div
          id={"order-" + o.id}
          className={`rounded-2xl border p-4 scroll-mt-20 target:border-[#E85D2C] ${
            isCancelled ? "bg-red-500/5 border-red-500/20" : "bg-[#F5E6C8]/5 border-[#F5E6C8]/10"
          }`}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={!!selected}
                onChange={onToggleSelect}
                className="accent-[#E85D2C] mt-1 shrink-0"
                aria-label={`Pilih pesanan ${o.id}`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[#E85D2C] text-xs font-bold">{o.id}</span>
                  <StatusBadge status={o.status} />
                  {o.isPo && (
                    <span className="text-[9px] font-bold uppercase bg-[#E85D2C] text-[#1C1512] px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Clock size={9} /> PO
                    </span>
                  )}
                </div>
                <p className="text-[#F5E6C8] font-semibold text-sm mt-1">{o.buyerName}</p>
                {o.buyerPhone && <p className="text-[#F5E6C8]/50 text-xs">{o.buyerPhone}</p>}
                {o.deliveryArea && (
                  <p className="text-[#E85D2C]/80 text-[10px] font-semibold uppercase mt-0.5">
                    {o.deliveryArea === "dalam-kota" ? "Dalam Kota" : "Luar Kota"} · {o.expedition || (o.deliveryArea === "dalam-kota" ? "GoSend" : "J&T")}
                </p>
              )}
              {o.paymentMethod && (
                <p className="text-[#4A7C59] text-[10px] font-semibold uppercase mt-0.5">
                  Bayar: {PAYMENT_METHODS.find((p) => p.id === o.paymentMethod)?.label || o.paymentMethod}
                </p>
              )}
              <p className="text-[#F5E6C8]/50 text-xs">{o.buyerAddr}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[#F5E6C8]/40 text-[10px] font-mono">
                {new Date(o.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="text-[#F5E6C8] font-mono font-bold mt-1">{rupiah(o.total)}</p>
            </div>
          </div>

          <div className="mt-3 border-t border-[#F5E6C8]/10 pt-3 grid gap-1">
            {o.items.map((i, idx) => (
              <div key={idx} className="flex justify-between text-xs text-[#F5E6C8]/70">
                <span>
                  {i.name} × {i.qty}
                  {i.isPo && <span className="text-[#E85D2C] font-semibold"> · PO ({i.poEta || "1-2 jam"})</span>}
                </span>
                <span className="font-mono">{rupiah(i.price * i.qty)}</span>
              </div>
            ))}
          </div>

          {isCancelled ? (
            <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/25 px-3 py-2">
              <p className="text-red-300 text-xs font-semibold">Pesanan dibatalkan</p>
              {o.cancelReason && <p className="text-red-300/70 text-[11px] mt-0.5">Alasan: {o.cancelReason}</p>}
              {o.cancelledAt && (
                <p className="text-red-300/50 text-[10px] mt-0.5 font-mono">
                  {new Date(o.cancelledAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {STATUS_FLOW.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(o.id, s)}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] flex items-center gap-1 ${
                    o.status === s ? "bg-[#4A7C59] text-[#F5E6C8]" : "bg-[#1C1512] text-[#F5E6C8]/50 hover:text-[#F5E6C8]"
                  }`}
                >
                  {o.status === s && <Check size={11} />} {s}
                </button>
              ))}
            </div>
          )}

          {!isCancelled && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5">
                <span className="text-[#F5E6C8]/40 text-xs whitespace-nowrap">Ongkir</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={o.shippingCost ?? ""}
                  onChange={(e) => updateShippingCost(o.id, e.target.value)}
                  placeholder="0"
                  className="w-24 bg-[#1C1512] text-[#F5E6C8] font-mono text-xs rounded-lg px-2 py-1.5 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
                />
              </label>
              {o.shippingCost > 0 && (
                <span className="text-[#F5E6C8]/40 text-[10px] font-mono">
                  Total + ongkir: {rupiah(o.total + (o.shippingCost || 0))}
                </span>
              )}
              <button
                onClick={() => sendLabelToWhatsApp(o)}
                className="text-xs px-3 py-1.5 rounded-full bg-[#1C1512] text-[#F5E6C8]/50 hover:text-[#F5E6C8] flex items-center gap-1 ml-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
              >
                <MessageCircle size={11} /> Kirim ke WA
              </button>
              <button
                onClick={() => printLabel(o)}
                className="text-xs px-3 py-1.5 rounded-full bg-[#1C1512] text-[#F5E6C8]/50 hover:text-[#F5E6C8] flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
              >
                <Printer size={11} /> Cetak label
              </button>
            </div>
          )}

          {!isCancelled && (
            showCancelConfirm ? (
              <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3 grid gap-2">
                <p className="text-red-300 text-xs font-semibold">Batalkan pesanan ini?</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {["Nomor WA tidak cocok dengan No. HP pesanan", "Stok tidak tersedia", "Pembeli membatalkan"].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setCancelReason(r)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[#1C1512] text-[#F5E6C8]/60 hover:text-[#F5E6C8] border border-[#F5E6C8]/10"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Alasan pembatalan (opsional)"
                  className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 text-xs rounded-lg px-3 py-2 border border-[#F5E6C8]/10 focus:border-red-400 outline-none"
                />
                {!isPhoneMismatch && (
                  <label className="flex items-center gap-2 text-[11px] text-[#F5E6C8]/70">
                    <input
                      type="checkbox"
                      checked={notifyBuyer}
                      onChange={(e) => setNotifyBuyer(e.target.checked)}
                      className="accent-[#E85D2C]"
                    />
                    Kirim pemberitahuan pembatalan ke WhatsApp pembeli
                  </label>
                )}
                {isPhoneMismatch && (
                  <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2.5 grid gap-2">
                    <p className="text-yellow-400/80 text-[11px] leading-relaxed">
                      ⚠️ Nomor di form pesanan ini tidak bisa dipercaya. Pemberitahuan otomatis ke nomor tersebut dimatikan — balas langsung dari chat WhatsApp yang benar-benar mengirim pesanan ini.
                    </p>
                    <button
                      type="button"
                      onClick={copyMismatchMessage}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full bg-[#1C1512] text-[#F5E6C8]/70 hover:text-[#F5E6C8] flex items-center gap-1.5 w-fit"
                    >
                      {copiedMismatchMsg ? <><Check size={11} /> Tersalin</> : <>Salin pesan pembatalan untuk di-paste</>}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleConfirmCancel}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/80 text-[#F5E6C8] hover:bg-red-500"
                  >
                    Ya, batalkan pesanan
                  </button>
                  <button
                    onClick={() => { setShowCancelConfirm(false); setCancelReason(""); }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full text-[#F5E6C8]/50 hover:text-[#F5E6C8] bg-[#1C1512]"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-[11px] font-semibold text-red-400/70 hover:text-red-400 flex items-center gap-1"
                >
                  <X size={12} /> Batalkan Pesanan
                </button>
              </div>
            )
          )}
        </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    Masuk: "bg-[#E85D2C]/20 text-[#E85D2C]",
    Diproses: "bg-yellow-500/15 text-yellow-400",
    Selesai: "bg-[#4A7C59]/20 text-[#4A7C59]",
    Dibatalkan: "bg-red-500/15 text-red-400",
  };
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${styles[status] || ""}`}>{status}</span>;
}

function MenuTab({ menu, updatePrice, updateDesc, updateStock, updatePoEta, addMenuItem, deleteMenuItem }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", desc: "", price: "", stock: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  function handleAdd() {
    if (!newItem.name.trim()) return;
    addMenuItem(newItem);
    setNewItem({ name: "", desc: "", price: "", stock: "" });
    setShowAddForm(false);
  }

  return (
    <div className="grid gap-3">
      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          className="rounded-2xl border border-dashed border-[#E85D2C]/40 text-[#E85D2C] font-semibold text-sm py-3 flex items-center justify-center gap-2 hover:bg-[#E85D2C]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C]"
        >
          <Plus size={16} /> Tambah Menu Baru
        </button>
      ) : (
        <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#E85D2C]/30 p-4 grid gap-2">
          <h3 className="text-[#F5E6C8] font-semibold text-sm">Menu Baru</h3>
          <input
            type="text"
            value={newItem.name}
            onChange={(e) => setNewItem((s) => ({ ...s, name: e.target.value }))}
            placeholder="Nama menu"
            className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 text-sm rounded-lg px-3 py-2 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
          />
          <textarea
            value={newItem.desc}
            onChange={(e) => setNewItem((s) => ({ ...s, desc: e.target.value }))}
            rows={2}
            placeholder="Deskripsi menu"
            className="bg-[#1C1512] text-[#F5E6C8]/70 placeholder-[#F5E6C8]/30 text-xs rounded-lg px-3 py-2 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none resize-none"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5">
              <span className="text-[#F5E6C8]/40 text-xs">Harga Rp</span>
              <input
                type="number"
                value={newItem.price}
                onChange={(e) => setNewItem((s) => ({ ...s, price: e.target.value }))}
                className="w-24 bg-[#1C1512] text-[#F5E6C8] font-mono text-sm rounded-lg px-2 py-1.5 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[#F5E6C8]/40 text-xs">Stok</span>
              <input
                type="number"
                min={0}
                value={newItem.stock}
                onChange={(e) => setNewItem((s) => ({ ...s, stock: e.target.value }))}
                className="w-20 bg-[#1C1512] text-[#F5E6C8] font-mono text-sm rounded-lg px-2 py-1.5 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handleAdd}
              disabled={!newItem.name.trim()}
              className="flex-1 bg-[#E85D2C] text-[#1C1512] font-semibold text-sm py-2 rounded-xl hover:bg-[#E85D2C]/85 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Check size={14} /> Simpan Menu
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewItem({ name: "", desc: "", price: "", stock: "" }); }}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-[#F5E6C8]/50 hover:text-[#F5E6C8] bg-[#1C1512]"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {menu.map((item) => {
        const stock = item.stock ?? 0;
        const isPo = stock <= 0;
        return (
          <div key={item.id} className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4 grid gap-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-[#F5E6C8] font-semibold text-sm">{item.name}</h3>
                {item.tag && <span className="text-[9px] font-bold uppercase bg-[#4A7C59] text-[#F5E6C8] px-2 py-0.5 rounded-full">{item.tag}</span>}
                {isPo && <span className="text-[9px] font-bold uppercase bg-[#E85D2C] text-[#1C1512] px-2 py-0.5 rounded-full">PO</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[#F5E6C8]/40 text-xs font-mono">Rp</span>
                <input
                  type="number"
                  value={item.price}
                  onChange={(e) => updatePrice(item.id, e.target.value)}
                  className="w-24 bg-[#1C1512] text-[#F5E6C8] font-mono text-sm rounded-lg px-2 py-1.5 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
                />
              </div>
            </div>
            <textarea
              value={item.desc}
              onChange={(e) => updateDesc(item.id, e.target.value)}
              rows={2}
              placeholder="Deskripsi menu"
              className="w-full bg-[#1C1512] text-[#F5E6C8]/70 placeholder-[#F5E6C8]/30 text-xs rounded-lg px-3 py-2 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none resize-none"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5">
                <span className="text-[#F5E6C8]/40 text-xs">Stok</span>
                <input
                  type="number"
                  min={0}
                  value={stock}
                  onChange={(e) => updateStock(item.id, e.target.value)}
                  className="w-20 bg-[#1C1512] text-[#F5E6C8] font-mono text-sm rounded-lg px-2 py-1.5 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
                />
              </label>
              {isPo && (
                <label className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                  <span className="text-[#F5E6C8]/40 text-xs whitespace-nowrap">Estimasi PO</span>
                  <input
                    type="text"
                    value={item.poEta || ""}
                    onChange={(e) => updatePoEta(item.id, e.target.value)}
                    placeholder="mis. 1-2 jam"
                    className="flex-1 bg-[#1C1512] text-[#F5E6C8] text-sm rounded-lg px-2 py-1.5 border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
                  />
                </label>
              )}
            </div>

            {confirmDeleteId === item.id ? (
              <div className="flex items-center gap-2 mt-1 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2">
                <span className="text-red-300 text-xs flex-1">Hapus menu ini secara permanen?</span>
                <button
                  onClick={() => { deleteMenuItem(item.id); setConfirmDeleteId(null); }}
                  className="text-xs font-semibold text-red-300 hover:text-red-200 px-2 py-1"
                >
                  Ya, hapus
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-xs font-semibold text-[#F5E6C8]/50 hover:text-[#F5E6C8] px-2 py-1"
                >
                  Batal
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(item.id)}
                className="justify-self-start text-[11px] font-semibold text-red-400/70 hover:text-red-400 flex items-center gap-1 mt-1"
              >
                <X size={12} /> Hapus menu
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[#F5E6C8]/30 text-xs text-center mt-2">Stok 0 otomatis menjadikan menu berstatus PO di web pesanan. Perubahan tersimpan otomatis.</p>
    </div>
  );
}

function ReportTab({ orders }) {
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const doneOrders = orders.filter((o) => o.status === "Selesai");
  const itemCounts = {};
  orders.forEach((o) => o.items.forEach((i) => { itemCounts[i.name] = (itemCounts[i.name] || 0) + i.qty; }));
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4">
          <p className="text-[#F5E6C8]/50 text-[10px] uppercase tracking-wide mb-1">Total omzet</p>
          <p className="text-[#F5E6C8] font-mono font-bold text-xl">{rupiah(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4">
          <p className="text-[#F5E6C8]/50 text-[10px] uppercase tracking-wide mb-1">Pesanan selesai</p>
          <p className="text-[#F5E6C8] font-mono font-bold text-xl">{doneOrders.length} / {orders.length}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4">
        <p className="text-[#F5E6C8] font-semibold text-sm mb-3">Menu terlaris</p>
        {topItems.length === 0 ? (
          <p className="text-[#F5E6C8]/40 text-xs">Belum ada data.</p>
        ) : (
          <div className="grid gap-2">
            {topItems.map(([name, qty], idx) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-[#E85D2C] font-mono text-xs w-4">{idx + 1}</span>
                <span className="text-[#F5E6C8] text-xs flex-1">{name}</span>
                <span className="text-[#F5E6C8]/60 font-mono text-xs">{qty}x</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TestimonialsTab({ testimonials, setTestimonialStatus }) {
  if (testimonials.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#F5E6C8]/15 p-10 text-center">
        <p className="text-[#F5E6C8]/50 text-sm">Belum ada testimoni masuk.</p>
      </div>
    );
  }

  const statusOrder = { pending: 0, approved: 1, rejected: 2 };
  const sorted = [...testimonials].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return (
    <div className="grid gap-3">
      {sorted.map((t) => (
        <div key={t.id} className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[#F5E6C8] font-semibold text-sm">{t.name}</span>
                <TestimonialStatusBadge status={t.status} />
              </div>
              <p className="text-[#F5E6C8]/50 text-xs mt-0.5">{t.phone}</p>
              <div className="flex items-center gap-0.5 mt-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    size={13}
                    className={i <= t.rating ? "text-yellow-400 fill-yellow-400" : "text-[#F5E6C8]/20"}
                  />
                ))}
              </div>
            </div>
            <p className="text-[#F5E6C8]/40 text-[10px] font-mono">
              {new Date(t.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>

          <p className="text-[#F5E6C8]/70 text-xs mt-3 leading-relaxed">{t.comment}</p>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setTestimonialStatus(t.id, "approved")}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] flex items-center gap-1 ${
                t.status === "approved" ? "bg-[#4A7C59] text-[#F5E6C8]" : "bg-[#1C1512] text-[#F5E6C8]/50 hover:text-[#F5E6C8]"
              }`}
            >
              <Check size={11} /> Setujui
            </button>
            <button
              onClick={() => setTestimonialStatus(t.id, "rejected")}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E85D2C] flex items-center gap-1 ${
                t.status === "rejected" ? "bg-red-500/70 text-[#F5E6C8]" : "bg-[#1C1512] text-[#F5E6C8]/50 hover:text-[#F5E6C8]"
              }`}
            >
              <X size={11} /> Tolak
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TestimonialStatusBadge({ status }) {
  const styles = {
    pending: "bg-yellow-500/15 text-yellow-400",
    approved: "bg-[#4A7C59]/20 text-[#4A7C59]",
    rejected: "bg-red-500/15 text-red-400",
  };
  const labels = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak" };
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${styles[status] || ""}`}>{labels[status] || status}</span>;
}

function ShopTab({ shopInfo, saveShopInfo }) {
  const [form, setForm] = useState({ paymentAccounts: {}, ...shopInfo });
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const ok = await saveShopInfo(form);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="rounded-2xl bg-[#F5E6C8]/5 border border-[#F5E6C8]/10 p-4 grid gap-3 max-w-md">
      <h3 className="text-[#F5E6C8] font-semibold text-sm flex items-center gap-2">
        <Store size={15} className="text-[#E85D2C]" /> Data Pengirim (untuk label)
      </h3>
      <p className="text-[#F5E6C8]/40 text-xs -mt-2">Data ini muncul di bagian "Pengirim" saat label dicetak.</p>
      <label className="grid gap-1">
        <span className="text-[#F5E6C8]/50 text-xs">Nama toko</span>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-[#1C1512] text-[#F5E6C8] rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[#F5E6C8]/50 text-xs">No. HP</span>
        <input
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="+62..."
          className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[#F5E6C8]/50 text-xs">Alamat</span>
        <textarea
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          rows={2}
          placeholder="Alamat lengkap warung"
          className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none resize-none"
        />
      </label>

      <div className="border-t border-[#F5E6C8]/10 pt-3 grid gap-1">
        <h3 className="text-[#F5E6C8] font-semibold text-sm flex items-center gap-2">
          <Clock size={15} className="text-[#E85D2C]" /> Jam Buka Pemesanan
        </h3>
        <p className="text-[#F5E6C8]/40 text-xs -mt-1 mb-1">Di luar jam ini, pembeli tidak bisa membuat pesanan baru. Waktu mengikuti WIB.</p>
        <div className="flex items-center gap-3">
          <label className="grid gap-1 flex-1">
            <span className="text-[#F5E6C8]/50 text-xs">Buka jam</span>
            <select
              value={form.openHour ?? DEFAULT_OPEN_HOUR}
              onChange={(e) => setForm({ ...form, openHour: Number(e.target.value) })}
              className="bg-[#1C1512] text-[#F5E6C8] rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}.00</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 flex-1">
            <span className="text-[#F5E6C8]/50 text-xs">Tutup jam</span>
            <select
              value={form.closeHour ?? DEFAULT_CLOSE_HOUR}
              onChange={(e) => setForm({ ...form, closeHour: Number(e.target.value) })}
              className="bg-[#1C1512] text-[#F5E6C8] rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}.00</option>
              ))}
            </select>
          </label>
        </div>
        {Number(form.closeHour ?? DEFAULT_CLOSE_HOUR) <= Number(form.openHour ?? DEFAULT_OPEN_HOUR) && (
          <p className="text-yellow-400 text-[11px] mt-0.5">Jam tutup sebaiknya lebih besar dari jam buka.</p>
        )}
      </div>

      <div className="border-t border-[#F5E6C8]/10 pt-3 grid gap-2">
        <h3 className="text-[#F5E6C8] font-semibold text-sm flex items-center gap-2">
          <Phone size={15} className="text-[#E85D2C]" /> Rekening / Nomor Pembayaran
        </h3>
        <p className="text-[#F5E6C8]/40 text-xs -mt-1 mb-1">
          Nomor ini otomatis dikirim ke pembeli di pesan WhatsApp dan label pengiriman sesuai metode bayar yang mereka pilih.
        </p>
        {PAYMENT_METHODS.map((m) => (
          <label key={m.id} className="grid gap-1">
            <span className="text-[#F5E6C8]/50 text-xs">{m.label}</span>
            <input
              value={form.paymentAccounts?.[m.id] || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  paymentAccounts: { ...(form.paymentAccounts || {}), [m.id]: e.target.value },
                })
              }
              placeholder={`No. ${m.label} / a.n. ...`}
              className="bg-[#1C1512] text-[#F5E6C8] placeholder-[#F5E6C8]/30 rounded-lg px-3 py-2.5 text-sm border border-[#F5E6C8]/10 focus:border-[#E85D2C] outline-none"
            />
          </label>
        ))}
      </div>

      <button
        onClick={handleSave}
        className="bg-[#E85D2C] text-[#1C1512] font-semibold text-sm py-2.5 rounded-xl hover:bg-[#E85D2C]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5E6C8] flex items-center justify-center gap-2"
      >
        {saved ? <><Check size={14} /> Tersimpan</> : "Simpan"}
      </button>
    </div>
  );
}
