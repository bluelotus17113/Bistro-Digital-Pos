'use strict';

// Todos los valores de dinero son enteros en pesos (COP), sin decimales.

function toInt(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Calcula los totales de una cuenta.
 * - taxIncluded: los precios del menú ya traen el impuesto (lo habitual con impoconsumo).
 * - El descuento se aplica sobre el valor de los productos, antes de la propina.
 * - La propina sugerida se calcula sobre la base sin impuesto y se redondea a la centena.
 */
function computeTotals({ items, discountType, discountValue, taxRate, taxIncluded, tipRate, tip }) {
  const gross = items.reduce((sum, it) => sum + toInt(it.unit_price) * toInt(it.qty), 0);

  let discount = 0;
  const dv = Number(discountValue) || 0;
  if (discountType === 'pct') {
    discount = Math.round((gross * Math.min(Math.max(dv, 0), 100)) / 100);
  } else if (discountType === 'valor') {
    discount = Math.min(Math.max(toInt(dv), 0), gross);
  }

  const net = gross - discount;
  const rate = Math.max(Number(taxRate) || 0, 0);
  let base;
  let tax;
  if (taxIncluded) {
    base = Math.round(net / (1 + rate / 100));
    tax = net - base;
  } else {
    base = net;
    tax = Math.round((base * rate) / 100);
  }

  // Se redondea a la centena para que el total se pueda pagar en efectivo sin monedas raras.
  const suggestedTip = Math.round((base * Math.max(Number(tipRate) || 0, 0)) / 10000) * 100;
  const tipAmount = Math.max(toInt(tip), 0);
  const total = base + tax + tipAmount;

  return { gross, discount, base, tax, tip: tipAmount, suggestedTip, total };
}

module.exports = { computeTotals, toInt };
