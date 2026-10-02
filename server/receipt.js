'use strict';

const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia (Nequi)' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  return `$ ${Math.round(n || 0).toLocaleString('es-CO')}`;
}

function dateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderReceipt(order, settings, { print = false } = {}) {
  const paid = order.status === 'pagada';
  const cancelled = order.status === 'anulada';
  const title = paid ? `Venta N.° ${order.number}` : cancelled ? 'Cuenta anulada' : 'Precuenta';
  const where = order.type === 'llevar'
    ? `Para llevar${order.label ? `: ${esc(order.label)}` : ''}`
    : `Mesa ${esc(order.table_name || '')}${order.zone_name ? ` (${esc(order.zone_name)})` : ''}`;
  const t = order.totals;

  const items = order.items.map((it) => `
    <tr><td class="q">${it.qty}</td><td>${esc(it.name)}${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</td><td class="n">${money(it.qty * it.unit_price)}</td></tr>`).join('');

  const row = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${value}</td></tr>`;
  const totals = [];
  totals.push(row('Productos', money(t.gross)));
  if (t.discount) totals.push(row('Descuento', `- ${money(t.discount)}`));
  if (order.tax.included) {
    totals.push(row('Base', money(t.base)));
    totals.push(row(`${esc(order.tax.name)} ${order.tax.rate} % (incluido)`, money(t.tax)));
  } else {
    totals.push(row(`${esc(order.tax.name)} ${order.tax.rate} %`, money(t.tax)));
  }
  if (paid) {
    if (t.tip) totals.push(row('Propina voluntaria', money(t.tip)));
    totals.push(row('Total', money(t.total), 'total'));
  } else {
    totals.push(row('Total sin propina', money(t.total), 'total'));
    if (!cancelled && t.suggestedTip) {
      totals.push(row(`Propina sugerida ${order.tip_rate} %`, money(t.suggestedTip)));
      totals.push(row('Total con propina', money(t.total + t.suggestedTip), 'total'));
    }
  }

  const payments = paid && order.payments.length ? `
    <table class="totals pay">
      ${order.payments.map((p) => row(METHOD_LABEL[p.method] || esc(p.method), money(p.received))).join('')}
      ${order.payments.some((p) => p.change > 0) ? row('Vuelto', money(order.payments.reduce((a, p) => a + p.change, 0))) : ''}
    </table>` : '';

  const tipNote = !paid && !cancelled && t.suggestedTip ? `
    <p class="legal">La propina es voluntaria. Usted puede aceptarla, rechazarla o modificarla según su valoración del servicio.</p>` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @font-face { font-family: "Courier Prime"; src: url("/fonts/courier-prime-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
  @font-face { font-family: "Courier Prime"; src: url("/fonts/courier-prime-latin-700-normal.woff2") format("woff2"); font-weight: 700; }
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #dfe5de; font: 12.5px/1.35 "Courier Prime", "Courier New", monospace; color: #000; }
  .ticket { width: 80mm; max-width: 100%; margin: 16px auto; padding: 6mm 5mm 8mm; background: #fff; }
  h1 { font-size: 17px; margin: 0 0 2px; text-align: center; }
  .head p { margin: 0; text-align: center; }
  .meta { margin: 10px 0; padding: 6px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
  .meta p { margin: 0; display: flex; justify-content: space-between; gap: 8px; }
  .kind { font-weight: 700; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .q { width: 2.2em; }
  .n { text-align: right; white-space: nowrap; padding-left: 6px; }
  .note { font-size: 11px; padding-left: 4px; }
  .totals { margin-top: 8px; border-top: 1px dashed #000; padding-top: 4px; }
  .totals.pay { margin-top: 6px; }
  .total td { font-weight: 700; font-size: 15px; padding-top: 4px; }
  .legal { font-size: 10.5px; margin: 10px 0 0; }
  .foot { margin: 12px 0 0; text-align: center; }
  .bar { display: flex; gap: 8px; justify-content: center; margin: 16px; font-family: system-ui, sans-serif; }
  .bar button { font: inherit; font-size: 15px; padding: 10px 18px; border-radius: 8px; border: 1px solid #12352b; background: #12352b; color: #fff; cursor: pointer; }
  .bar button.alt { background: #fff; color: #12352b; }
  @media print { body { background: #fff; } .ticket { margin: 0; } .bar { display: none; } }
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()">Imprimir</button><button class="alt" onclick="window.close()">Cerrar</button></div>
<div class="ticket">
  <div class="head">
    <h1>${esc(settings.business_name)}</h1>
    ${settings.business_nit ? `<p>NIT ${esc(settings.business_nit)}</p>` : ''}
    ${settings.business_address ? `<p>${esc(settings.business_address)}</p>` : ''}
    ${settings.business_phone ? `<p>Tel. ${esc(settings.business_phone)}</p>` : ''}
  </div>
  <div class="meta">
    <p class="kind"><span>${esc(title)}</span></p>
    <p><span>${where}</span></p>
    <p><span>${paid || cancelled ? 'Cierre' : 'Apertura'}</span><span>${esc(dateTime(paid || cancelled ? order.closed_at : order.opened_at))}</span></p>
    ${cancelled ? `<p><span>Motivo: ${esc(order.cancel_reason)}</span></p>` : ''}
    ${order.note ? `<p><span>Nota: ${esc(order.note)}</span></p>` : ''}
  </div>
  <table>${items}</table>
  <table class="totals">${totals.join('')}</table>
  ${payments}
  ${tipNote}
  ${paid && settings.receipt_footer ? `<p class="foot">${esc(settings.receipt_footer)}</p>` : ''}
  ${paid ? '<p class="legal">Comprobante interno de venta. No reemplaza la factura electrónica.</p>' : ''}
</div>
${print ? '<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>' : ''}
</body>
</html>`;
}

module.exports = { renderReceipt };
