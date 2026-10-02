'use strict';

const ExcelJS = require('exceljs');

const MONEY = '#,##0';
const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
const STATUS_LABEL = { pagada: 'Pagada', anulada: 'Anulada' };

// Excel no maneja zonas horarias: se guarda la hora local "tal cual" para que la celda muestre la hora del negocio.
function localDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}

function place(order) {
  if (order.type === 'llevar') return order.label ? `Para llevar: ${order.label}` : 'Para llevar';
  return order.table_name ? `Mesa ${order.table_name}` : 'Mesa';
}

function discountLabel(order) {
  if (order.discount_type === 'pct') return `${order.discount_value} %`;
  if (order.discount_type === 'valor') return 'Valor fijo';
  return '';
}

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12352B' } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.columnCount) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  }
}

function buildWorkbook(data, settings) {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.business_name || 'Bistro Digital POS';
  wb.created = new Date();
  const s = data.summary;
  const orderById = new Map(data.orders.map((o) => [o.id, o]));

  // ----- Resumen -----
  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [{ width: 34 }, { width: 18 }, { width: 14 }];
  resumen.addRow([settings.business_name || 'Ventas']).font = { bold: true, size: 14 };
  if (settings.business_nit) resumen.addRow([`NIT ${settings.business_nit}`]);
  resumen.addRow([data.from === data.to ? `Ventas del ${data.from}` : `Ventas del ${data.from} al ${data.to}`]);
  resumen.addRow([]);
  const line = (label, value, { bold = false, money = true } = {}) => {
    const row = resumen.addRow([label, value]);
    if (money) row.getCell(2).numFmt = MONEY;
    if (bold) row.font = { bold: true };
    return row;
  };
  line('Ventas pagadas', s.count, { money: false });
  line('Cuentas anuladas', s.cancelled, { money: false });
  resumen.addRow([]);
  line('Valor de productos', s.gross);
  line('Descuentos', -s.discount);
  line('Base sin impuesto', s.base);
  line(`${settings.tax_name}`, s.tax);
  line('Venta total (sin propinas)', s.base + s.tax, { bold: true });
  line('Propinas', s.tip);
  line('Total recaudado', s.total, { bold: true });
  line('Promedio por venta (sin propina)', s.average);
  resumen.addRow([]);
  resumen.addRow(['Recaudo por método de pago']).font = { bold: true };
  for (const [method, amount] of Object.entries(s.byMethod)) line(METHOD_LABEL[method] || method, amount);

  // ----- Ventas -----
  const ventas = wb.addWorksheet('Ventas');
  ventas.columns = [
    { header: 'Venta N.°', key: 'number', width: 10 },
    { header: 'Fecha y hora', key: 'closed', width: 19, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Estado', key: 'status', width: 10 },
    { header: 'Tipo', key: 'type', width: 11 },
    { header: 'Mesa / cliente', key: 'place', width: 22 },
    { header: 'Zona', key: 'zone', width: 12 },
    { header: 'Apertura', key: 'opened', width: 19, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Productos', key: 'gross', width: 13, style: { numFmt: MONEY } },
    { header: 'Descuento', key: 'discount', width: 12, style: { numFmt: MONEY } },
    { header: 'Tipo de descuento', key: 'discountLabel', width: 17 },
    { header: 'Base', key: 'base', width: 13, style: { numFmt: MONEY } },
    { header: 'Impuesto', key: 'tax', width: 12, style: { numFmt: MONEY } },
    { header: 'Propina', key: 'tip', width: 11, style: { numFmt: MONEY } },
    { header: 'Total', key: 'total', width: 13, style: { numFmt: MONEY } },
    { header: 'Motivo de anulación', key: 'reason', width: 30 },
  ];
  for (const o of data.orders) {
    ventas.addRow({
      number: o.number ?? '',
      closed: localDate(o.closed_at),
      status: STATUS_LABEL[o.status] || o.status,
      type: o.type === 'llevar' ? 'Para llevar' : 'Mesa',
      place: place(o),
      zone: o.zone_name || '',
      opened: localDate(o.opened_at),
      gross: o.gross, discount: o.discount, discountLabel: discountLabel(o),
      base: o.base, tax: o.tax, tip: o.tip, total: o.total,
      reason: o.cancel_reason || '',
    });
  }
  styleHeader(ventas);

  // ----- Detalle -----
  const detalle = wb.addWorksheet('Detalle');
  detalle.columns = [
    { header: 'Venta N.°', key: 'number', width: 10 },
    { header: 'Fecha y hora', key: 'closed', width: 19, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Estado', key: 'status', width: 10 },
    { header: 'Mesa / cliente', key: 'place', width: 22 },
    { header: 'Categoría', key: 'category', width: 18 },
    { header: 'Producto', key: 'name', width: 30 },
    { header: 'Cantidad', key: 'qty', width: 10 },
    { header: 'Precio unitario', key: 'price', width: 15, style: { numFmt: MONEY } },
    { header: 'Subtotal', key: 'subtotal', width: 13, style: { numFmt: MONEY } },
    { header: 'Nota', key: 'note', width: 30 },
  ];
  for (const it of data.items) {
    const o = orderById.get(it.order_id);
    detalle.addRow({
      number: o.number ?? '', closed: localDate(o.closed_at), status: STATUS_LABEL[o.status] || o.status,
      place: place(o), category: it.category, name: it.name, qty: it.qty,
      price: it.unit_price, subtotal: it.unit_price * it.qty, note: it.note,
    });
  }
  styleHeader(detalle);

  // ----- Pagos -----
  const pagos = wb.addWorksheet('Pagos');
  pagos.columns = [
    { header: 'Venta N.°', key: 'number', width: 10 },
    { header: 'Fecha y hora', key: 'at', width: 19, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Método', key: 'method', width: 15 },
    { header: 'Valor', key: 'amount', width: 13, style: { numFmt: MONEY } },
    { header: 'Recibido', key: 'received', width: 13, style: { numFmt: MONEY } },
    { header: 'Vuelto', key: 'change', width: 12, style: { numFmt: MONEY } },
  ];
  for (const p of data.payments) {
    const o = orderById.get(p.order_id);
    pagos.addRow({
      number: o.number ?? '', at: localDate(p.created_at), method: METHOD_LABEL[p.method] || p.method,
      amount: p.amount, received: p.received, change: p.received - p.amount,
    });
  }
  styleHeader(pagos);

  // ----- Productos -----
  const productos = wb.addWorksheet('Productos');
  productos.columns = [
    { header: 'Categoría', key: 'category', width: 18 },
    { header: 'Producto', key: 'name', width: 30 },
    { header: 'Unidades vendidas', key: 'qty', width: 18 },
    { header: 'Valor vendido', key: 'amount', width: 15, style: { numFmt: MONEY } },
  ];
  for (const p of s.byProduct) productos.addRow(p);
  styleHeader(productos);

  return wb;
}

module.exports = { buildWorkbook };
