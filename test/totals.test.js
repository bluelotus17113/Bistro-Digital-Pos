'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals } = require('../server/totals');

const items = [
  { unit_price: 38000, qty: 2 },
  { unit_price: 11000, qty: 1 },
  { unit_price: 8500, qty: 3 },
]; // 76.000 + 11.000 + 25.500 = 112.500

test('impuesto incluido en el precio: el total no cambia y se discrimina la base', () => {
  const t = computeTotals({ items, discountType: 'ninguno', discountValue: 0, taxRate: 8, taxIncluded: true, tipRate: 10, tip: 0 });
  assert.equal(t.gross, 112500);
  assert.equal(t.base, 104167);
  assert.equal(t.tax, 8333);
  assert.equal(t.base + t.tax, 112500);
  assert.equal(t.total, 112500);
  assert.equal(t.suggestedTip, 10400);
});

test('impuesto no incluido: se suma sobre la base', () => {
  const t = computeTotals({ items, discountType: 'ninguno', discountValue: 0, taxRate: 8, taxIncluded: false, tipRate: 10, tip: 0 });
  assert.equal(t.base, 112500);
  assert.equal(t.tax, 9000);
  assert.equal(t.total, 121500);
  assert.equal(t.suggestedTip, 11300);
});

test('descuento en porcentaje y propina', () => {
  const t = computeTotals({ items, discountType: 'pct', discountValue: 10, taxRate: 8, taxIncluded: true, tipRate: 10, tip: 9000 });
  assert.equal(t.discount, 11250);
  assert.equal(t.base + t.tax, 101250);
  assert.equal(t.total, 110250);
});

test('descuento en valor nunca supera el valor de los productos', () => {
  const t = computeTotals({ items, discountType: 'valor', discountValue: 500000, taxRate: 8, taxIncluded: true, tipRate: 10, tip: 0 });
  assert.equal(t.discount, 112500);
  assert.equal(t.total, 0);
  assert.equal(t.tax, 0);
});

test('sin impuesto configurado', () => {
  const t = computeTotals({ items, discountType: 'ninguno', discountValue: 0, taxRate: 0, taxIncluded: true, tipRate: 0, tip: 0 });
  assert.equal(t.tax, 0);
  assert.equal(t.base, 112500);
  assert.equal(t.suggestedTip, 0);
});
