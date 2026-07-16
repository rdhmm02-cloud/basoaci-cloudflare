-- Bakso Aci App — initial D1 schema

CREATE TABLE IF NOT EXISTS menu (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT,
  desc TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  po_eta TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  buyer_name TEXT,
  buyer_phone TEXT,
  buyer_addr TEXT,
  delivery_area TEXT,
  expedition TEXT,
  payment_method TEXT,
  items_json TEXT NOT NULL,      -- JSON array of {id,name,qty,price,isPo,poEta}
  total INTEGER NOT NULL DEFAULT 0,
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  is_po INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Masuk',   -- Masuk | Diproses | Selesai | Dibatalkan
  cancel_reason TEXT,
  cancelled_at TEXT,
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  phone TEXT,
  address TEXT,
  open_hour INTEGER NOT NULL DEFAULT 8,
  close_hour INTEGER NOT NULL DEFAULT 19,
  payment_accounts_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS testimonials (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  rating INTEGER NOT NULL DEFAULT 5,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session tokens issued after successful PIN check (kept server-side)
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

INSERT OR IGNORE INTO shop_info (id, name, phone, address, open_hour, close_hour, payment_accounts_json)
VALUES (1, 'Bakso Aci SINDHEL_official', '', '', 8, 19, '{"seabank":"","dana":"","gopay":"","shopeepay":""}');

INSERT OR IGNORE INTO menu (id, name, tag, desc, price, stock, po_eta, sort_order) VALUES
('jando', 'Bakso Aci Jando Manis', 'Best Seller', 'Isi jando manis khas, kuah rica pedas gurih', 15000, 50, '1-2 jam', 1),
('keju', 'Bakso Aci Keju', NULL, 'Lumer keju di setiap gigitan', 17000, 50, '1-2 jam', 2),
('ayam-cincang-manis', 'Bakso Aci Ayam Cincang Manis', NULL, 'Isi ayam cincang bumbu manis gurih', 16000, 50, '1-2 jam', 3),
('ayam-original', 'Bakso Aci Ayam Original', NULL, 'Rasa original ayam, cocok untuk yang tidak suka manis', 15000, 50, '1-2 jam', 4);
