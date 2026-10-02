'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

let server;
let base;

test.before(async () => {
  const app = createApp(openDatabase(':memory:'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('flujo completo: abrir mesa, pedir, cobrar y exportar', async () => {
  const boot = (await api('GET', '/api/bootstrap')).data;
  assert.ok(boot.tables.length >= 8);
  const mesa = boot.tables[0];
  const bandeja = boot.products.find((p) => p.name === 'Bandeja paisa');
  const cerveza = boot.products.find((p) => p.name === 'Cerveza nacional');

  let r = await api('POST', '/api/orders', { table_id: mesa.id });
  assert.equal(r.status, 201);
  const orderId = r.data.id;

  // Abrir la misma mesa otra vez devuelve la misma cuenta.
  r = await api('POST', '/api/orders', { table_id: mesa.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.id, orderId);

  await api('POST', `/api/orders/${orderId}/items`, { product_id: bandeja.id, qty: 2 });
  await api('POST', `/api/orders/${orderId}/items`, { product_id: cerveza.id });
  r = await api('POST', `/api/orders/${orderId}/items`, { product_id: cerveza.id });
  assert.equal(r.data.items.length, 2, 'el mismo producto sin nota se agrupa');
  r = await api('POST', `/api/orders/${orderId}/items`, { product_id: bandeja.id, note: 'Sin chicharrón' });
  assert.equal(r.data.items.length, 3, 'con nota va en otra línea');
  assert.equal(r.data.totals.gross, 38000 * 3 + 8500 * 2);

  const salon = (await api('GET', '/api/salon')).data;
  assert.equal(salon.orders.length, 1);
  assert.equal(salon.orders[0].gross, 131000);

  r = await api('PATCH', `/api/orders/${orderId}`, { status: 'por_cobrar', discount_type: 'pct', discount_value: 10 });
  assert.equal(r.data.status, 'por_cobrar');
  assert.equal(r.data.totals.discount, 13100);
  const total = r.data.totals.total; // 117.900
  assert.equal(total, 117900);

  // Pago insuficiente
  r = await api('POST', `/api/orders/${orderId}/pay`, { tip: 10000, payments: [{ method: 'efectivo', amount: 100000 }] });
  assert.equal(r.status, 400);
  // Tarjeta por encima del total
  r = await api('POST', `/api/orders/${orderId}/pay`, { tip: 0, payments: [{ method: 'tarjeta', amount: 200000 }] });
  assert.equal(r.status, 400);

  // Pago mixto con vuelto
  r = await api('POST', `/api/orders/${orderId}/pay`, {
    tip: 10000,
    payments: [{ method: 'tarjeta', amount: 50000 }, { method: 'efectivo', amount: 80000 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'pagada');
  assert.equal(r.data.number, 1);
  assert.equal(r.data.totals.total, 127900);
  const cash = r.data.payments.find((p) => p.method === 'efectivo');
  assert.equal(cash.received, 80000);
  assert.equal(cash.amount, 77900);
  assert.equal(cash.change, 2100);

  // Ya cerrada: no se modifica
  r = await api('POST', `/api/orders/${orderId}/items`, { product_id: cerveza.id });
  assert.equal(r.status, 409);

  // La mesa quedó libre
  assert.equal((await api('GET', '/api/salon')).data.orders.length, 0);

  const sales = (await api('GET', '/api/sales')).data;
  assert.equal(sales.summary.count, 1);
  assert.equal(sales.summary.total, 127900);
  assert.equal(sales.summary.tip, 10000);
  assert.equal(sales.summary.byMethod.tarjeta, 50000);
  assert.equal(sales.summary.byMethod.efectivo, 77900);

  const res = await fetch(`${base}/api/export`);
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen', 'Ventas', 'Detalle', 'Pagos', 'Productos']);
  assert.equal(wb.getWorksheet('Ventas').rowCount, 2);
  assert.equal(wb.getWorksheet('Detalle').rowCount, 4);
  assert.equal(wb.getWorksheet('Ventas').getRow(2).getCell(14).value, 127900);

  const recibo = await fetch(`${base}/recibo/${orderId}`);
  const html = await recibo.text();
  assert.match(html, /Venta N\.° 1/);
  assert.match(html, /Sin chicharrón/);
});

test('para llevar, cambio de mesa y anulación', async () => {
  const boot = (await api('GET', '/api/bootstrap')).data;
  const [m1, m2] = boot.tables;
  const cafe = boot.products.find((p) => p.name === 'Café tinto');

  let r = await api('POST', '/api/orders', { type: 'llevar', label: 'Camila' });
  assert.equal(r.status, 201);
  const llevar = r.data.id;
  r = await api('PATCH', `/api/orders/${llevar}`, { table_id: m1.id });
  assert.equal(r.status, 400);

  // Cuenta vacía: se elimina sin pedir motivo
  r = await api('POST', `/api/orders/${llevar}/cancel`, {});
  assert.equal(r.data.removed, true);

  const a = (await api('POST', '/api/orders', { table_id: m1.id })).data.id;
  const b = (await api('POST', '/api/orders', { table_id: m2.id })).data.id;
  await api('POST', `/api/orders/${a}/items`, { product_id: cafe.id, qty: 2 });

  r = await api('PATCH', `/api/orders/${a}`, { table_id: m2.id });
  assert.equal(r.status, 409, 'no se mueve a una mesa ocupada');
  await api('POST', `/api/orders/${b}/cancel`, {});
  r = await api('PATCH', `/api/orders/${a}`, { table_id: m2.id });
  assert.equal(r.data.table_id, m2.id);

  r = await api('POST', `/api/orders/${a}/pay`, { tip: 0, payments: [] });
  assert.equal(r.status, 400);

  r = await api('POST', `/api/orders/${a}/cancel`, {});
  assert.equal(r.status, 400, 'una cuenta con productos pide motivo');
  r = await api('POST', `/api/orders/${a}/cancel`, { reason: 'El cliente se fue' });
  assert.equal(r.data.removed, false);
  const sales = (await api('GET', '/api/sales')).data;
  assert.equal(sales.summary.cancelled, 1);
});

test('administración de menú, mesas y ajustes', async () => {
  let r = await api('POST', '/api/categories', { name: 'Cocteles' });
  const catId = r.data.id;
  r = await api('POST', '/api/products', { category_id: catId, name: 'Mojito', price: 22000 });
  assert.equal(r.status, 201);
  const prodId = r.data.id;
  r = await api('POST', '/api/products', { category_id: catId, name: '', price: 100 });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/products', { category_id: catId, name: 'X', price: -5 });
  assert.equal(r.status, 400);
  r = await api('DELETE', `/api/categories/${catId}`);
  assert.equal(r.status, 409);
  await api('DELETE', `/api/products/${prodId}`);
  r = await api('DELETE', `/api/categories/${catId}`);
  assert.equal(r.status, 200);

  r = await api('PUT', '/api/settings', {
    business_name: 'La Cazuela', business_nit: '900123456-7', business_address: '', business_phone: '',
    tax_name: 'Impoconsumo', tax_rate: 8, tax_included: false, tip_rate: 10, receipt_footer: 'Vuelva pronto',
  });
  assert.equal(r.data.tax_included, false);
  r = await api('PUT', '/api/settings', { business_name: 'X', tax_name: 'IVA', tax_rate: 250, tip_rate: 10 });
  assert.equal(r.status, 400);

  const boot = (await api('GET', '/api/bootstrap')).data;
  const zone = boot.zones[0];
  r = await api('POST', '/api/tables', { zone_id: zone.id, name: '99', seats: 4 });
  const tableId = r.data.id;
  const order = (await api('POST', '/api/orders', { table_id: tableId })).data;
  await api('POST', `/api/orders/${order.id}/items`, { product_id: boot.products[0].id });
  r = await api('DELETE', `/api/tables/${tableId}`);
  assert.equal(r.status, 409);
  r = await api('GET', `/api/orders/${order.id}`);
  assert.equal(r.data.tax.included, false);
  assert.equal(r.data.totals.total, Math.round(boot.products[0].price * 1.08));
});
