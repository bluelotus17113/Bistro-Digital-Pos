'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER,
  type TEXT NOT NULL DEFAULT 'mesa',
  table_id INTEGER REFERENCES tables(id),
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'abierta',
  discount_type TEXT NOT NULL DEFAULT 'ninguno',
  discount_value REAL NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  cancel_reason TEXT,
  tax_name TEXT,
  tax_rate REAL,
  tax_included INTEGER,
  gross INTEGER,
  discount INTEGER,
  base INTEGER,
  tax INTEGER,
  tip INTEGER,
  total INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders(closed_at);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  received INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
`;

const DEFAULT_SETTINGS = {
  business_name: 'Bistro Digital',
  business_nit: '',
  business_address: '',
  business_phone: '',
  tax_name: 'Impoconsumo',
  tax_rate: '8',
  tax_included: '1',
  tip_rate: '10',
  receipt_footer: '¡Gracias por su visita!',
};

const SEED_MENU = [
  ['Entradas', [
    ['Empanadas de carne (3)', 12000],
    ['Patacones con hogao', 14000],
    ['Ceviche de camarón', 26000],
    ['Sopa del día', 11000],
  ]],
  ['Platos fuertes', [
    ['Bandeja paisa', 38000],
    ['Mojarra frita', 36000],
    ['Lomo al trapo', 46000],
    ['Pechuga a la plancha', 29000],
    ['Arroz con camarones', 39000],
    ['Pasta al pesto', 28000],
  ]],
  ['Bebidas', [
    ['Limonada de coco', 11000],
    ['Jugo natural en agua', 8000],
    ['Jugo natural en leche', 9500],
    ['Gaseosa', 6000],
    ['Cerveza nacional', 8500],
    ['Agua', 4500],
    ['Café tinto', 3500],
  ]],
  ['Postres', [
    ['Tres leches', 12000],
    ['Flan de caramelo', 10000],
    ['Brownie con helado', 14000],
  ]],
];

const SEED_ZONES = [
  ['Salón', [['1', 2], ['2', 2], ['3', 4], ['4', 4], ['5', 4], ['6', 6], ['7', 6], ['8', 8]]],
  ['Terraza', [['T1', 2], ['T2', 4], ['T3', 4], ['T4', 6]]],
];

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

  // Datos de ejemplo solo en una base nueva, para poder probar de inmediato.
  const fresh = db.prepare('SELECT COUNT(*) AS n FROM zones').get().n === 0
    && db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0;
  if (fresh) {
    db.exec('BEGIN');
    const zone = db.prepare('INSERT INTO zones (name, sort) VALUES (?, ?)');
    const table = db.prepare('INSERT INTO tables (zone_id, name, seats) VALUES (?, ?, ?)');
    SEED_ZONES.forEach(([name, tables], i) => {
      const zoneId = zone.run(name, i).lastInsertRowid;
      for (const [tname, seats] of tables) table.run(zoneId, tname, seats);
    });
    const cat = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)');
    const prod = db.prepare('INSERT INTO products (category_id, name, price) VALUES (?, ?, ?)');
    SEED_MENU.forEach(([name, products], i) => {
      const catId = cat.run(name, i).lastInsertRowid;
      for (const [pname, price] of products) prod.run(catId, pname, price);
    });
    db.exec('COMMIT');
  }
  return db;
}

module.exports = { openDatabase, DEFAULT_SETTINGS };
