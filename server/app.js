'use strict';

const path = require('node:path');
const express = require('express');
const { computeTotals, toInt } = require('./totals');
const { buildWorkbook } = require('./excel');
const { renderReceipt } = require('./receipt');

const METHODS = ['efectivo', 'tarjeta', 'transferencia'];
const OPEN_STATUSES = ['abierta', 'por_cobrar'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  // ---------- utilidades ----------
  const now = () => new Date().toISOString();

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function getSettings() {
    const out = {};
    for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
    return {
      business_name: out.business_name || '',
      business_nit: out.business_nit || '',
      business_address: out.business_address || '',
      business_phone: out.business_phone || '',
      tax_name: out.tax_name || 'Impuesto',
      tax_rate: Number(out.tax_rate) || 0,
      tax_included: out.tax_included === '1',
      tip_rate: Number(out.tip_rate) || 0,
      receipt_footer: out.receipt_footer || '',
    };
  }

  function text(value, field, { max = 80, required = true } = {}) {
    const s = String(value ?? '').trim();
    if (required && !s) throw new HttpError(400, `Falta ${field}.`);
    if (s.length > max) throw new HttpError(400, `${field} no puede tener más de ${max} caracteres.`);
    return s;
  }

  function positiveInt(value, field, { min = 0, max = 1e9 } = {}) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} no es válido.`);
    return n;
  }

  function idParam(req, name = 'id') {
    const n = Number(req.params[name]);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador no válido.');
    return n;
  }

  function getOrderRow(id) {
    const row = db.prepare(`
      SELECT o.*, t.name AS table_name, z.name AS zone_name
      FROM orders o
      LEFT JOIN tables t ON t.id = o.table_id
      LEFT JOIN zones z ON z.id = t.zone_id
      WHERE o.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Ese pedido no existe.');
    return row;
  }

  function requireOpen(order) {
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new HttpError(409, 'Este pedido ya está cerrado y no se puede modificar.');
    }
  }

  function orderDetail(id) {
    const order = getOrderRow(id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
    const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').all(id);
    const settings = getSettings();
    const isOpen = OPEN_STATUSES.includes(order.status);
    let totals;
    let tax;
    if (order.status === 'pagada') {
      // Una venta cerrada conserva los valores con los que se cobró.
      totals = {
        gross: order.gross, discount: order.discount, base: order.base,
        tax: order.tax, tip: order.tip, suggestedTip: 0, total: order.total,
      };
      tax = { name: order.tax_name, rate: order.tax_rate, included: !!order.tax_included };
    } else {
      totals = computeTotals({
        items,
        discountType: order.discount_type,
        discountValue: order.discount_value,
        taxRate: settings.tax_rate,
        taxIncluded: settings.tax_included,
        tipRate: settings.tip_rate,
        tip: 0,
      });
      tax = { name: settings.tax_name, rate: settings.tax_rate, included: settings.tax_included };
    }
    return {
      id: order.id,
      number: order.number,
      type: order.type,
      table_id: order.table_id,
      table_name: order.table_name,
      zone_name: order.zone_name,
      label: order.label,
      status: order.status,
      is_open: isOpen,
      discount_type: order.discount_type,
      discount_value: order.discount_value,
      opened_at: order.opened_at,
      closed_at: order.closed_at,
      cancel_reason: order.cancel_reason,
      items: items.map((i) => ({ ...i })),
      payments: payments.map((p) => ({ ...p, change: p.received - p.amount })),
      totals,
      tax,
      tip_rate: settings.tip_rate,
    };
  }

  function localRange(from, to) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const f = re.test(from || '') ? from : todayStr;
    const t = re.test(to || '') ? to : f;
    const start = new Date(`${f}T00:00:00`);
    const end = new Date(`${t}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new HttpError(400, 'Fechas no válidas.');
    if (end < start) throw new HttpError(400, 'La fecha final no puede ser anterior a la inicial.');
    end.setDate(end.getDate() + 1);
    return { from: f, to: t, startIso: start.toISOString(), endIso: end.toISOString() };
  }

  function salesData(from, to) {
    const range = localRange(from, to);
    const orders = db.prepare(`
      SELECT o.*, t.name AS table_name, z.name AS zone_name
      FROM orders o
      LEFT JOIN tables t ON t.id = o.table_id
      LEFT JOIN zones z ON z.id = t.zone_id
      WHERE o.status IN ('pagada', 'anulada') AND o.closed_at >= ? AND o.closed_at < ?
      ORDER BY o.closed_at`).all(range.startIso, range.endIso);
    const ids = orders.map((o) => o.id);
    const marks = ids.map(() => '?').join(',') || 'NULL';
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${marks}) ORDER BY order_id, id`).all(...ids);
    const payments = db.prepare(`SELECT * FROM payments WHERE order_id IN (${marks}) ORDER BY order_id, id`).all(...ids);

    const paid = orders.filter((o) => o.status === 'pagada');
    const paidIds = new Set(paid.map((o) => o.id));
    const sum = (key) => paid.reduce((acc, o) => acc + (o[key] || 0), 0);
    const byMethod = Object.fromEntries(METHODS.map((m) => [m, 0]));
    for (const p of payments) if (paidIds.has(p.order_id)) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
    const productMap = new Map();
    for (const it of items) {
      if (!paidIds.has(it.order_id)) continue;
      const key = `${it.category}|${it.name}`;
      const cur = productMap.get(key) || { name: it.name, category: it.category, qty: 0, amount: 0 };
      cur.qty += it.qty;
      cur.amount += it.qty * it.unit_price;
      productMap.set(key, cur);
    }
    const byProduct = [...productMap.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

    return {
      from: range.from,
      to: range.to,
      orders: orders.map((o) => ({ ...o })),
      items: items.map((i) => ({ ...i })),
      payments: payments.map((p) => ({ ...p })),
      summary: {
        count: paid.length,
        cancelled: orders.length - paid.length,
        gross: sum('gross'),
        discount: sum('discount'),
        base: sum('base'),
        tax: sum('tax'),
        tip: sum('tip'),
        total: sum('total'),
        average: paid.length ? Math.round((sum('total') - sum('tip')) / paid.length) : 0,
        byMethod,
        byProduct,
      },
    };
  }

  // ---------- datos generales ----------
  app.get('/api/bootstrap', (req, res) => {
    res.json({
      settings: getSettings(),
      zones: db.prepare('SELECT * FROM zones WHERE active = 1 ORDER BY sort, id').all(),
      tables: db.prepare('SELECT * FROM tables WHERE active = 1 ORDER BY id').all(),
      categories: db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id').all(),
      // En el orden de la carta impresa, que es el que el personal ya conoce.
      products: db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id').all(),
      methods: METHODS,
    });
  });

  app.get('/api/salon', (req, res) => {
    const open = db.prepare(`
      SELECT o.id, o.type, o.table_id, o.label, o.status, o.opened_at,
             COALESCE(SUM(i.qty), 0) AS item_count,
             COALESCE(SUM(i.qty * i.unit_price), 0) AS gross
      FROM orders o
      LEFT JOIN order_items i ON i.order_id = o.id
      WHERE o.status IN ('abierta', 'por_cobrar')
      GROUP BY o.id
      ORDER BY o.opened_at`).all();
    res.json({ orders: open });
  });

  app.put('/api/settings', (req, res) => {
    const b = req.body || {};
    const rate = (v, field) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `${field} debe estar entre 0 y 100.`);
      return String(n);
    };
    const values = {
      business_name: text(b.business_name, 'el nombre del negocio'),
      business_nit: text(b.business_nit, 'NIT', { required: false, max: 40 }),
      business_address: text(b.business_address, 'Dirección', { required: false, max: 120 }),
      business_phone: text(b.business_phone, 'Teléfono', { required: false, max: 40 }),
      tax_name: text(b.tax_name, 'el nombre del impuesto', { max: 30 }),
      tax_rate: rate(b.tax_rate, 'El porcentaje de impuesto'),
      tax_included: b.tax_included ? '1' : '0',
      tip_rate: rate(b.tip_rate, 'El porcentaje de propina'),
      receipt_footer: text(b.receipt_footer, 'Mensaje del recibo', { required: false, max: 160 }),
    };
    tx(() => {
      const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      for (const [k, v] of Object.entries(values)) stmt.run(k, v);
    });
    res.json(getSettings());
  });

  // ---------- zonas y mesas ----------
  app.post('/api/zones', (req, res) => {
    const name = text(req.body?.name, 'el nombre de la zona', { max: 40 });
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM zones').get().s;
    const id = db.prepare('INSERT INTO zones (name, sort) VALUES (?, ?)').run(name, sort).lastInsertRowid;
    res.status(201).json({ id: Number(id), name, sort, active: 1 });
  });

  app.put('/api/zones/:id', (req, res) => {
    const id = idParam(req);
    const name = text(req.body?.name, 'el nombre de la zona', { max: 40 });
    const r = db.prepare('UPDATE zones SET name = ? WHERE id = ? AND active = 1').run(name, id);
    if (!r.changes) throw new HttpError(404, 'Esa zona no existe.');
    res.json({ id, name });
  });

  app.delete('/api/zones/:id', (req, res) => {
    const id = idParam(req);
    const used = db.prepare('SELECT COUNT(*) AS n FROM tables WHERE zone_id = ? AND active = 1').get(id).n;
    if (used) throw new HttpError(409, 'Quita o mueve primero las mesas de esta zona.');
    db.prepare('UPDATE zones SET active = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  function tableBody(body) {
    const zoneId = positiveInt(body?.zone_id, 'La zona', { min: 1 });
    if (!db.prepare('SELECT id FROM zones WHERE id = ? AND active = 1').get(zoneId)) throw new HttpError(400, 'Esa zona no existe.');
    return {
      zoneId,
      name: text(body?.name, 'el nombre de la mesa', { max: 12 }),
      seats: positiveInt(body?.seats, 'El número de puestos', { min: 1, max: 60 }),
    };
  }

  app.post('/api/tables', (req, res) => {
    const t = tableBody(req.body);
    const id = db.prepare('INSERT INTO tables (zone_id, name, seats) VALUES (?, ?, ?)').run(t.zoneId, t.name, t.seats).lastInsertRowid;
    res.status(201).json({ id: Number(id), zone_id: t.zoneId, name: t.name, seats: t.seats, active: 1 });
  });

  app.put('/api/tables/:id', (req, res) => {
    const id = idParam(req);
    const t = tableBody(req.body);
    const r = db.prepare('UPDATE tables SET zone_id = ?, name = ?, seats = ? WHERE id = ? AND active = 1').run(t.zoneId, t.name, t.seats, id);
    if (!r.changes) throw new HttpError(404, 'Esa mesa no existe.');
    res.json({ id, zone_id: t.zoneId, name: t.name, seats: t.seats });
  });

  app.delete('/api/tables/:id', (req, res) => {
    const id = idParam(req);
    const busy = db.prepare("SELECT id FROM orders WHERE table_id = ? AND status IN ('abierta','por_cobrar')").get(id);
    if (busy) throw new HttpError(409, 'Esta mesa tiene una cuenta abierta. Ciérrala antes de quitarla.');
    db.prepare('UPDATE tables SET active = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- menú ----------
  app.post('/api/categories', (req, res) => {
    const name = text(req.body?.name, 'el nombre de la categoría', { max: 40 });
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM categories').get().s;
    const id = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)').run(name, sort).lastInsertRowid;
    res.status(201).json({ id: Number(id), name, sort, active: 1 });
  });

  app.put('/api/categories/:id', (req, res) => {
    const id = idParam(req);
    const name = text(req.body?.name, 'el nombre de la categoría', { max: 40 });
    const r = db.prepare('UPDATE categories SET name = ? WHERE id = ? AND active = 1').run(name, id);
    if (!r.changes) throw new HttpError(404, 'Esa categoría no existe.');
    res.json({ id, name });
  });

  app.delete('/api/categories/:id', (req, res) => {
    const id = idParam(req);
    const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND active = 1').get(id).n;
    if (used) throw new HttpError(409, 'Quita o mueve primero los productos de esta categoría.');
    db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  function productBody(body) {
    const categoryId = positiveInt(body?.category_id, 'La categoría', { min: 1 });
    if (!db.prepare('SELECT id FROM categories WHERE id = ? AND active = 1').get(categoryId)) throw new HttpError(400, 'Esa categoría no existe.');
    return {
      categoryId,
      name: text(body?.name, 'el nombre del producto', { max: 60 }),
      price: positiveInt(body?.price, 'El precio', { min: 0, max: 100000000 }),
      description: text(body?.description, 'La descripción', { required: false, max: 160 }),
    };
  }

  app.post('/api/products', (req, res) => {
    const p = productBody(req.body);
    const id = db.prepare('INSERT INTO products (category_id, name, price, description) VALUES (?, ?, ?, ?)')
      .run(p.categoryId, p.name, p.price, p.description).lastInsertRowid;
    res.status(201).json({ id: Number(id), category_id: p.categoryId, name: p.name, price: p.price, description: p.description, active: 1 });
  });

  app.put('/api/products/:id', (req, res) => {
    const id = idParam(req);
    const p = productBody(req.body);
    const r = db.prepare('UPDATE products SET category_id = ?, name = ?, price = ?, description = ? WHERE id = ? AND active = 1')
      .run(p.categoryId, p.name, p.price, p.description, id);
    if (!r.changes) throw new HttpError(404, 'Ese producto no existe.');
    res.json({ id, category_id: p.categoryId, name: p.name, price: p.price, description: p.description });
  });

  app.delete('/api/products/:id', (req, res) => {
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(idParam(req));
    res.json({ ok: true });
  });

  // ---------- pedidos ----------
  app.post('/api/orders', (req, res) => {
    const b = req.body || {};
    const result = tx(() => {
      if (b.type === 'llevar') {
        const label = text(b.label, 'Nombre', { required: false, max: 40 });
        const id = db.prepare("INSERT INTO orders (type, label, opened_at) VALUES ('llevar', ?, ?)").run(label, now()).lastInsertRowid;
        return { id: Number(id), created: true };
      }
      const tableId = positiveInt(b.table_id, 'La mesa', { min: 1 });
      if (!db.prepare('SELECT id FROM tables WHERE id = ? AND active = 1').get(tableId)) throw new HttpError(404, 'Esa mesa no existe.');
      const existing = db.prepare("SELECT id FROM orders WHERE table_id = ? AND status IN ('abierta','por_cobrar')").get(tableId);
      if (existing) return { id: existing.id, created: false };
      const id = db.prepare("INSERT INTO orders (type, table_id, opened_at) VALUES ('mesa', ?, ?)").run(tableId, now()).lastInsertRowid;
      return { id: Number(id), created: true };
    });
    res.status(result.created ? 201 : 200).json(orderDetail(result.id));
  });

  app.get('/api/orders/:id', (req, res) => {
    res.json(orderDetail(idParam(req)));
  });

  app.patch('/api/orders/:id', (req, res) => {
    const id = idParam(req);
    const b = req.body || {};
    tx(() => {
      const order = getOrderRow(id);
      requireOpen(order);
      if (b.status !== undefined) {
        if (!OPEN_STATUSES.includes(b.status)) throw new HttpError(400, 'Estado no válido.');
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(b.status, id);
      }
      if (b.label !== undefined) {
        db.prepare('UPDATE orders SET label = ? WHERE id = ?').run(text(b.label, 'Nombre', { required: false, max: 40 }), id);
      }
      if (b.discount_type !== undefined) {
        const type = b.discount_type;
        if (!['ninguno', 'pct', 'valor'].includes(type)) throw new HttpError(400, 'Tipo de descuento no válido.');
        let value = type === 'ninguno' ? 0 : Number(b.discount_value);
        if (!Number.isFinite(value) || value < 0) throw new HttpError(400, 'El descuento no es válido.');
        if (type === 'pct' && value > 100) throw new HttpError(400, 'El descuento no puede pasar del 100 %.');
        if (type === 'valor') value = Math.round(value);
        db.prepare('UPDATE orders SET discount_type = ?, discount_value = ? WHERE id = ?').run(type, value, id);
      }
      if (b.table_id !== undefined) {
        if (order.type !== 'mesa') throw new HttpError(400, 'Solo las cuentas de mesa se pueden cambiar de mesa.');
        const tableId = positiveInt(b.table_id, 'La mesa', { min: 1 });
        if (tableId !== order.table_id) {
          if (!db.prepare('SELECT id FROM tables WHERE id = ? AND active = 1').get(tableId)) throw new HttpError(404, 'Esa mesa no existe.');
          const busy = db.prepare("SELECT id FROM orders WHERE table_id = ? AND status IN ('abierta','por_cobrar')").get(tableId);
          if (busy) throw new HttpError(409, 'La mesa de destino ya tiene una cuenta abierta.');
          db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(tableId, id);
        }
      }
    });
    res.json(orderDetail(id));
  });

  app.post('/api/orders/:id/items', (req, res) => {
    const id = idParam(req);
    const b = req.body || {};
    tx(() => {
      const order = getOrderRow(id);
      requireOpen(order);
      const productId = positiveInt(b.product_id, 'El producto', { min: 1 });
      const qty = positiveInt(b.qty ?? 1, 'La cantidad', { min: 1, max: 999 });
      const note = text(b.note, 'Nota', { required: false, max: 120 });
      const product = db.prepare(`
        SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = ? AND p.active = 1`).get(productId);
      if (!product) throw new HttpError(404, 'Ese producto ya no está en el menú.');
      // Mismo producto sin nota: se suma a la línea existente.
      const same = note ? null : db.prepare(
        "SELECT id FROM order_items WHERE order_id = ? AND product_id = ? AND note = '' AND unit_price = ?",
      ).get(id, productId, product.price);
      if (same) {
        db.prepare('UPDATE order_items SET qty = MIN(qty + ?, 999) WHERE id = ?').run(qty, same.id);
      } else {
        db.prepare(`INSERT INTO order_items (order_id, product_id, name, category, unit_price, qty, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, productId, product.name, product.category, product.price, qty, note, now());
      }
      // Si ya se había pedido la cuenta y se agrega algo, vuelve a quedar abierta.
      if (order.status === 'por_cobrar') db.prepare("UPDATE orders SET status = 'abierta' WHERE id = ?").run(id);
    });
    res.status(201).json(orderDetail(id));
  });

  app.patch('/api/orders/:id/items/:itemId', (req, res) => {
    const id = idParam(req);
    const itemId = idParam(req, 'itemId');
    const b = req.body || {};
    tx(() => {
      requireOpen(getOrderRow(id));
      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, id);
      if (!item) throw new HttpError(404, 'Ese producto ya no está en la cuenta.');
      if (b.qty !== undefined) {
        const qty = positiveInt(b.qty, 'La cantidad', { min: 0, max: 999 });
        if (qty === 0) db.prepare('DELETE FROM order_items WHERE id = ?').run(itemId);
        else db.prepare('UPDATE order_items SET qty = ? WHERE id = ?').run(qty, itemId);
      }
      if (b.note !== undefined) {
        db.prepare('UPDATE order_items SET note = ? WHERE id = ?').run(text(b.note, 'Nota', { required: false, max: 120 }), itemId);
      }
    });
    res.json(orderDetail(id));
  });

  app.delete('/api/orders/:id/items/:itemId', (req, res) => {
    const id = idParam(req);
    tx(() => {
      requireOpen(getOrderRow(id));
      db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(idParam(req, 'itemId'), id);
    });
    res.json(orderDetail(id));
  });

  app.post('/api/orders/:id/pay', (req, res) => {
    const id = idParam(req);
    const b = req.body || {};
    tx(() => {
      const order = getOrderRow(id);
      requireOpen(order);
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
      if (!items.length) throw new HttpError(400, 'La cuenta no tiene productos.');
      const tip = positiveInt(b.tip ?? 0, 'La propina', { min: 0, max: 100000000 });
      const settings = getSettings();
      const totals = computeTotals({
        items,
        discountType: order.discount_type,
        discountValue: order.discount_value,
        taxRate: settings.tax_rate,
        taxIncluded: settings.tax_included,
        tipRate: settings.tip_rate,
        tip,
      });

      const tendered = Object.fromEntries(METHODS.map((m) => [m, 0]));
      for (const p of Array.isArray(b.payments) ? b.payments : []) {
        if (!METHODS.includes(p?.method)) throw new HttpError(400, 'Método de pago no válido.');
        const amount = toInt(p.amount, -1);
        if (amount < 0) throw new HttpError(400, 'El valor del pago no es válido.');
        tendered[p.method] += amount;
      }
      const received = METHODS.reduce((acc, m) => acc + tendered[m], 0);
      if (received < totals.total) {
        throw new HttpError(400, `Faltan ${totals.total - received} pesos para completar el pago.`);
      }
      const change = received - totals.total;
      if (change > tendered.efectivo) {
        throw new HttpError(400, 'Los pagos con tarjeta o transferencia no pueden superar el total de la cuenta.');
      }

      const closedAt = now();
      const number = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM orders').get().n;
      const insert = db.prepare('INSERT INTO payments (order_id, method, amount, received, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const m of METHODS) {
        if (!tendered[m]) continue;
        const amount = m === 'efectivo' ? tendered[m] - change : tendered[m];
        insert.run(id, m, amount, tendered[m], closedAt);
      }
      db.prepare(`UPDATE orders SET status = 'pagada', number = ?, closed_at = ?, tax_name = ?, tax_rate = ?, tax_included = ?,
                  gross = ?, discount = ?, base = ?, tax = ?, tip = ?, total = ? WHERE id = ?`)
        .run(number, closedAt, settings.tax_name, settings.tax_rate, settings.tax_included ? 1 : 0,
          totals.gross, totals.discount, totals.base, totals.tax, totals.tip, totals.total, id);
    });
    res.json(orderDetail(id));
  });

  app.post('/api/orders/:id/cancel', (req, res) => {
    const id = idParam(req);
    const removed = tx(() => {
      const order = getOrderRow(id);
      requireOpen(order);
      const count = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').get(id).n;
      if (!count) {
        // Una cuenta vacía no deja rastro: fue una mesa abierta por error.
        db.prepare('DELETE FROM orders WHERE id = ?').run(id);
        return true;
      }
      const reason = text(req.body?.reason, 'el motivo de la anulación', { max: 160 });
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
      const settings = getSettings();
      const totals = computeTotals({
        items, discountType: order.discount_type, discountValue: order.discount_value,
        taxRate: settings.tax_rate, taxIncluded: settings.tax_included, tipRate: 0, tip: 0,
      });
      db.prepare(`UPDATE orders SET status = 'anulada', closed_at = ?, cancel_reason = ?, tax_name = ?, tax_rate = ?, tax_included = ?,
                  gross = ?, discount = ?, base = ?, tax = ?, tip = 0, total = ? WHERE id = ?`)
        .run(now(), reason, settings.tax_name, settings.tax_rate, settings.tax_included ? 1 : 0,
          totals.gross, totals.discount, totals.base, totals.tax, totals.total, id);
      return false;
    });
    res.json({ ok: true, removed });
  });

  // ---------- ventas, exportación y recibo ----------
  app.get('/api/sales', (req, res) => {
    const data = salesData(req.query.from, req.query.to);
    res.json({ from: data.from, to: data.to, orders: data.orders, summary: data.summary });
  });

  app.get('/api/export', async (req, res) => {
    const data = salesData(req.query.from, req.query.to);
    const workbook = buildWorkbook(data, getSettings());
    const name = data.from === data.to ? `ventas_${data.from}.xlsx` : `ventas_${data.from}_a_${data.to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await workbook.xlsx.write(res);
    res.end();
  });

  app.get('/recibo/:id', (req, res) => {
    const order = orderDetail(idParam(req));
    res.type('html').send(renderReceipt(order, getSettings(), { print: req.query.imprimir === '1' }));
  });

  // ---------- archivos y errores ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Ocurrió un error en el servidor.' : err.message;
    if (req.path.startsWith('/api')) res.status(status).json({ error: message });
    else res.status(status).type('text').send(message);
  });

  return app;
}

module.exports = { createApp };
