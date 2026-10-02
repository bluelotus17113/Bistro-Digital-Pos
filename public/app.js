// Bistro Digital POS: interfaz. Sin dependencias ni paso de compilación.

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');
const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia (Nequi)' };

const state = { boot: null, poll: null, renderId: 0 };

// ---------- utilidades ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === false || child == null) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Reemplaza el contenido de un elemento; acepta listas anidadas y valores vacíos igual que h().
function fill(el, ...children) {
  const nodes = [];
  for (const child of children.flat(Infinity)) {
    if (child === false || child == null) continue;
    nodes.push(child.nodeType ? child : document.createTextNode(String(child)));
  }
  el.replaceChildren(...nodes);
}

const money = (n) => `$ ${Math.round(n || 0).toLocaleString('es-CO')}`;
const digits = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function elapsed(iso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function dayAndClock(iso) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
function toast(message, bad = false) {
  $toast.textContent = message;
  $toast.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.className = 'toast'; }, bad ? 4500 : 2200);
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No hay conexión con el servidor del POS. Revisa que esté encendido y que estés en la misma red.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la acción.');
  return data;
}

// Ejecuta una acción y muestra el error si falla. Devuelve undefined en caso de error.
async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    return undefined;
  }
}

async function loadBoot() {
  state.boot = await api('GET', '/api/bootstrap');
  const name = state.boot.settings.business_name || 'Bistro';
  document.getElementById('brand').textContent = name.split(' ')[0];
  document.title = `${name} POS`;
  return state.boot;
}

function setNotesCount(n) {
  const el = document.getElementById('notes-count');
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n || '');
  el.setAttribute('aria-label', n === 1 ? '1 nota pendiente' : `${n} notas pendientes`);
}

// ---------- diálogos ----------
function openDialog(build) {
  const dialog = h('dialog');
  const close = (value) => { dialog.close(); dialog.remove(); resolveFn(value); };
  let resolveFn;
  const done = new Promise((resolve) => { resolveFn = resolve; });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
  dialog.append(build(close, dialog));
  document.body.append(dialog);
  dialog.showModal();
  return done;
}

function confirmDialog({ title, text, confirmLabel, danger = false }) {
  return openDialog((close) => h('div', { class: 'dlg' },
    h('h2', null, title),
    text && h('p', null, text),
    h('div', { class: 'dlg-actions' },
      h('button', { class: 'btn quiet', onclick: () => close(false) }, 'Volver'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirmLabel),
    ),
  ));
}

// fields: [{ name, label, type: 'text'|'number'|'select', value, options, hint, required }]
function formDialog({ title, fields, submitLabel, onSubmit }) {
  return openDialog((close) => {
    const inputs = {};
    const form = h('form', { class: 'dlg', novalidate: true },
      h('h2', null, title),
      fields.map((f) => {
        let input;
        if (f.type === 'select') {
          input = h('select', { name: f.name },
            f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
        } else if (f.type === 'textarea') {
          input = h('textarea', { name: f.name, maxlength: f.maxlength || null, rows: 5 });
          input.value = f.value ?? '';
        } else {
          input = h('input', {
            type: 'text',
            inputmode: f.type === 'number' ? 'numeric' : null,
            name: f.name,
            value: f.value ?? '',
            maxlength: f.maxlength || null,
            placeholder: f.placeholder || null,
            autocomplete: 'off',
          });
        }
        inputs[f.name] = input;
        return h('label', { class: 'field' }, f.label, f.hint && h('span', { class: 'hint' }, f.hint), input);
      }),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => close(undefined) }, 'Volver'),
        h('button', { type: 'submit', class: 'btn primary' }, submitLabel),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const raw = inputs[f.name].value.trim();
        values[f.name] = f.type === 'number' ? digits(raw) : f.type === 'select' ? Number(raw) : raw;
      }
      const result = await attempt(() => onSubmit(values));
      if (result !== undefined) close(result);
    });
    setTimeout(() => { const first = inputs[fields[0].name]; first.focus(); if (first.select) first.select(); }, 30);
    return form;
  });
}

// ---------- salón ----------
async function viewSalon(isCurrent) {
  const boot = await loadBoot();
  if (!isCurrent()) return;
  let lastJson = '';

  const openTable = async (table, order) => {
    if (order) { location.hash = `#/pedido/${order.id}`; return; }
    const created = await attempt(() => api('POST', '/api/orders', { table_id: table.id }));
    if (created) location.hash = `#/pedido/${created.id}`;
  };

  const newTakeaway = async () => {
    const created = await formDialog({
      title: 'Pedido para llevar',
      fields: [{ name: 'label', label: 'Nombre de quien recoge', hint: 'Opcional', maxlength: 40 }],
      submitLabel: 'Abrir pedido',
      onSubmit: (v) => api('POST', '/api/orders', { type: 'llevar', label: v.label }),
    });
    if (created) location.hash = `#/pedido/${created.id}`;
  };

  const render = (orders) => {
    const byTable = new Map(orders.filter((o) => o.table_id).map((o) => [o.table_id, o]));
    const takeaway = orders.filter((o) => o.type === 'llevar');
    const busy = byTable.size;
    const tile = (label, seatsText, order, onclick) => h('button', {
      class: `mesa${order ? (order.status === 'por_cobrar' ? ' is-bill' : ' is-open') : ''}`,
      onclick,
    },
    h('div', null,
      h('div', { class: 'name' }, label),
      h('div', { class: 'seats' }, seatsText)),
    order
      ? h('div', null,
        order.note && h('div', { class: 'tile-note' }, order.note),
        h('div', { class: 'amount num' }, money(order.gross)),
        h('div', { class: 'state' }, order.status === 'por_cobrar' ? 'Pidió la cuenta' : `Hace ${elapsed(order.opened_at)}`))
      : h('div', { class: 'state seats' }, 'Libre'));

    fill($view,
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, 'Salón'),
          h('p', { class: 'sub' }, busy
            ? `${busy} de ${boot.tables.length} mesas con cuenta abierta`
            : 'Todas las mesas están libres. Toca una mesa para abrir su cuenta.')),
        h('button', { class: 'btn primary', onclick: newTakeaway }, 'Pedido para llevar')),
      boot.zones.length === 0 && h('p', { class: 'empty' }, 'Aún no hay mesas. Créalas en Ajustes.'),
      boot.zones.map((zone) => {
        const tables = boot.tables.filter((t) => t.zone_id === zone.id);
        return h('section', { class: 'zone' },
          h('h2', null, zone.name),
          tables.length
            ? h('div', { class: 'tables' }, tables.map((t) => tile(
              t.name, `${t.seats} ${t.seats === 1 ? 'puesto' : 'puestos'}`, byTable.get(t.id), () => openTable(t, byTable.get(t.id)))))
            : h('p', { class: 'empty' }, 'Esta zona no tiene mesas.'));
      }),
      takeaway.length > 0 && h('section', { class: 'zone' },
        h('h2', null, 'Para llevar'),
        h('div', { class: 'tables' }, takeaway.map((o) => tile(
          o.label || `N.° ${o.id}`, `${o.item_count} ${o.item_count === 1 ? 'producto' : 'productos'}`, o,
          () => { location.hash = `#/pedido/${o.id}`; })))),
      h('p', { class: 'legend' },
        h('span', null, h('i'), 'Libre'),
        h('span', null, h('i', { class: 'open' }), 'Con cuenta abierta'),
        h('span', null, h('i', { class: 'bill' }), 'Pidió la cuenta')),
    );
  };

  const refresh = async () => {
    try {
      const data = await api('GET', '/api/salon');
      if (!isCurrent()) return;
      setNotesCount(data.pending_notes);
      // La clave incluye el minuto para que el tiempo transcurrido se actualice solo.
      const json = JSON.stringify(data.orders) + Math.floor(Date.now() / 60000);
      if (json !== lastJson) { lastJson = json; render(data.orders); }
    } catch (err) {
      if (isCurrent() && !lastJson) fill($view, h('p', { class: 'empty' }, err.message));
    }
  };
  await refresh();
  state.poll = setInterval(refresh, 5000);
}

// ---------- pedido ----------
async function viewOrder(isCurrent, orderId) {
  let order;
  try {
    [, order] = await Promise.all([loadBoot(), api('GET', `/api/orders/${orderId}`)]);
  } catch (err) {
    if (!isCurrent()) return;
    fill($view, h('div', { class: 'page-head' }, h('h1', null, 'Pedido')),
      h('p', { class: 'empty' }, err.message), h('p', null, h('a', { class: 'btn', href: '#/salon' }, 'Volver al salón')));
    return;
  }
  if (!isCurrent()) return;
  let boot = state.boot;
  if (!order.is_open) {
    fill($view,
      h('div', { class: 'page-head' }, h('h1', null, order.status === 'pagada' ? `Venta N.° ${order.number}` : 'Cuenta anulada')),
      h('p', { class: 'empty' }, 'Esta cuenta ya está cerrada y no se puede modificar.'),
      h('p', { class: 'row', style: 'margin-top:16px' },
        h('a', { class: 'btn', href: `/recibo/${order.id}`, target: '_blank', rel: 'noopener' }, 'Ver recibo'),
        h('a', { class: 'btn primary', href: '#/salon' }, 'Volver al salón')));
    return;
  }

  $view.classList.add('is-order');
  let category = boot.categories[0]?.id ?? null;
  let query = '';

  const title = () => (order.type === 'llevar'
    ? `Para llevar${order.label ? `: ${order.label}` : ''}`
    : `Mesa ${order.table_name}`);

  const $root = h('div', { class: 'order' });
  const $top = h('div', { class: 'order-top' });
  const $cats = h('div', { class: 'cats' });
  const $products = h('div', { class: 'products' });
  const $side = h('aside', { class: 'order-side' });
  const $cartBar = h('button', { class: 'cart-bar', onclick: () => $root.classList.add('show-ticket') });
  const $search = h('input', {
    type: 'search', placeholder: 'Buscar por nombre o ingrediente', 'aria-label': 'Buscar producto',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderProducts(); },
  });

  const update = (next) => { if (next) { order = next; renderAll(); } };

  // Si otro dispositivo cambió el menú (por ejemplo, marcó algo como no disponible), se vuelve a cargar.
  const refreshMenu = async () => {
    await attempt(loadBoot);
    boot = state.boot;
    renderCats();
    renderProducts();
  };
  const addProduct = async (p) => {
    const next = await attempt(() => api('POST', `/api/orders/${order.id}/items`, { product_id: p.id }));
    if (next) update(next); else refreshMenu();
  };
  const setQty = async (item, qty) => {
    const next = await attempt(() => api('PATCH', `/api/orders/${order.id}/items/${item.id}`, { qty }));
    if (next) update(next); else refreshMenu();
  };

  const editNote = async (item) => {
    const next = await formDialog({
      title: `Nota para ${item.name}`,
      fields: [{ name: 'note', label: 'Indicación para cocina', hint: 'Por ejemplo: sin cebolla, término medio', value: item.note, maxlength: 120 }],
      submitLabel: 'Guardar nota',
      onSubmit: (v) => api('PATCH', `/api/orders/${order.id}/items/${item.id}`, { note: v.note }),
    });
    update(next);
  };

  const editOrderNote = async () => {
    const next = await formDialog({
      title: 'Nota de la cuenta',
      fields: [{
        name: 'note', label: 'Nota para toda la cuenta', value: order.note, maxlength: 200,
        hint: 'Por ejemplo: cumpleaños, alergia al maní, pasan a recoger a las 7. Sale en la precuenta y el recibo',
      }],
      submitLabel: 'Guardar nota',
      onSubmit: (v) => api('PATCH', `/api/orders/${order.id}`, { note: v.note }),
    });
    update(next);
  };

  const moveTable = async () => {
    const salon = await attempt(() => api('GET', '/api/salon'));
    if (!salon) return;
    const busy = new Set(salon.orders.map((o) => o.table_id));
    const free = boot.tables.filter((t) => !busy.has(t.id));
    const next = await openDialog((close) => h('div', { class: 'dlg' },
      h('h2', null, `Cambiar la cuenta de ${title()}`),
      free.length
        ? h('div', { class: 'block' }, h('p', null, 'Elige la mesa libre a la que pasa la cuenta.'),
          h('div', { class: 'tablepick' }, free.map((t) => h('button', {
            onclick: async () => {
              const moved = await attempt(() => api('PATCH', `/api/orders/${order.id}`, { table_id: t.id }));
              if (moved) close(moved);
            },
          }, t.name))))
        : h('p', null, 'No hay mesas libres en este momento.'),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn quiet', onclick: () => close(undefined) }, 'Volver'))));
    if (next) { update(next); toast(`Cuenta pasada a la mesa ${next.table_name}`); }
  };

  const cancelOrder = async () => {
    if (!order.items.length) {
      const ok = await attempt(() => api('POST', `/api/orders/${order.id}/cancel`, {}));
      if (ok) location.hash = '#/salon';
      return;
    }
    const done = await formDialog({
      title: 'Anular la cuenta',
      fields: [{ name: 'reason', label: 'Motivo de la anulación', hint: 'Queda registrado en el historial de ventas', maxlength: 160 }],
      submitLabel: 'Anular cuenta',
      onSubmit: (v) => api('POST', `/api/orders/${order.id}/cancel`, { reason: v.reason }),
    });
    if (done) { toast('Cuenta anulada'); location.hash = '#/salon'; }
  };

  const preBill = async () => {
    const win = window.open('about:blank', '_blank');
    const next = await attempt(() => api('PATCH', `/api/orders/${order.id}`, { status: 'por_cobrar' }));
    if (!next) { if (win) win.close(); return; }
    if (win) win.location = `/recibo/${order.id}?imprimir=1`;
    update(next);
  };

  function renderTop() {
    fill($top,
      h('a', { class: 'btn quiet small', href: '#/salon', 'aria-label': 'Volver al salón' }, '‹ Salón'),
      h('h1', null, title()),
      order.status === 'por_cobrar' && h('span', { class: 'chip' }, 'Pidió la cuenta'),
      order.type === 'mesa' && h('button', { class: 'btn small', onclick: moveTable }, 'Cambiar de mesa'),
      h('button', { class: 'btn small danger', onclick: cancelOrder }, order.items.length ? 'Anular cuenta' : 'Cerrar sin pedido'),
    );
  }

  function renderCats() {
    fill($cats, boot.categories.map((c) => h('button', {
      class: `cat${!query && c.id === category ? ' is-current' : ''}`,
      onclick: () => { category = c.id; query = ''; $search.value = ''; renderCats(); renderProducts(); },
    }, c.name)));
  }

  function renderProducts() {
    const counts = new Map();
    for (const it of order.items) counts.set(it.product_id, (counts.get(it.product_id) || 0) + it.qty);
    const list = query
      ? boot.products.filter((p) => `${p.name} ${p.description || ''}`.toLowerCase().includes(query))
      : boot.products.filter((p) => p.category_id === category);
    fill($products, list.length
      ? list.map((p) => h('button', {
        class: `product${p.available ? '' : ' is-out'}`, disabled: !p.available, onclick: () => addProduct(p),
      },
        counts.get(p.id) && h('span', { class: 'badge num' }, counts.get(p.id)),
        !p.available && h('span', { class: 'out-tag' }, 'No disponible'),
        h('span', null, h('span', { class: 'pname' }, p.name), p.description && h('span', { class: 'pdesc' }, p.description)),
        h('span', { class: 'pprice num' }, money(p.price))))
      : h('p', { class: 'empty' }, query
        ? `Ningún producto coincide con "${query}".`
        : boot.categories.length ? 'Esta categoría no tiene productos.' : 'El menú está vacío. Agrégale productos en la sección Menú.'));
    if (query) renderCats();
  }

  function renderSide() {
    const t = order.totals;
    const count = order.items.reduce((a, i) => a + i.qty, 0);
    fill($cartBar,
      h('span', null, count ? `Ver cuenta (${count})` : 'Ver cuenta'),
      h('span', { class: 'num' }, money(t.total)));
    fill($side,
      h('button', { class: 'btn small only-mobile', style: 'margin-bottom:12px', onclick: () => $root.classList.remove('show-ticket') }, '‹ Seguir pidiendo'),
      h('div', { class: 'ticket' },
        h('div', { class: 'ticket-head' },
          h('div', { class: 't1' }, title()),
          h('div', { class: 't2' }, `Abierta a las ${clock(order.opened_at)}${order.zone_name ? `, ${order.zone_name}` : ''}`),
          order.note && h('div', { class: 'ticket-note' }, `Nota: ${order.note}`),
          h('button', { class: 'linkish ticket-note-btn', onclick: editOrderNote }, order.note ? 'Cambiar nota de la cuenta' : 'Agregar nota a la cuenta')),
        h('div', { class: 'ticket-items' },
          order.items.length
            ? order.items.map((it) => h('div', { class: 'line' },
              h('div', { class: 'line-main' },
                h('span', { class: 'lname' }, it.name),
                h('span', { class: 'num' }, money(it.qty * it.unit_price))),
              it.note && h('div', { class: 'line-note' }, `* ${it.note}`),
              h('div', { class: 'line-tools' },
                h('button', { class: 'step', 'aria-label': `Quitar una unidad de ${it.name}`, onclick: () => setQty(it, it.qty - 1) }, '−'),
                h('span', { class: 'qty' }, it.qty),
                h('button', { class: 'step', 'aria-label': `Agregar una unidad de ${it.name}`, onclick: () => setQty(it, it.qty + 1) }, '+'),
                h('button', { class: 'linkish', onclick: () => editNote(it) }, it.note ? 'Cambiar nota' : 'Agregar nota'),
                h('button', { class: 'linkish danger', onclick: () => setQty(it, 0) }, 'Quitar'))))
            : h('p', { class: 'ticket-empty' }, 'Toca un producto del menú para agregarlo a la cuenta.')),
        h('div', { class: 'ticket-totals' },
          t.discount > 0 && [
            h('div', { class: 'trow' }, h('span', null, 'Productos'), h('span', { class: 'num' }, money(t.gross))),
            h('div', { class: 'trow' }, h('span', null, 'Descuento'), h('span', { class: 'num' }, `- ${money(t.discount)}`)),
          ],
          order.tax.rate > 0 && h('div', { class: 'trow' },
            h('span', null, `${order.tax.name} ${order.tax.rate} %${order.tax.included ? ' (incluido)' : ''}`),
            h('span', { class: 'num' }, money(t.tax))),
          h('div', { class: 'trow grand' }, h('span', null, 'Total'), h('span', { class: 'num' }, money(t.total))))),
      h('div', { class: 'side-actions' },
        h('button', { class: 'btn', disabled: !order.items.length, onclick: preBill }, 'Precuenta'),
        h('button', { class: 'btn pay', disabled: !order.items.length, onclick: () => checkout(order, update) }, 'Cobrar')),
    );
  }

  function renderAll() { renderTop(); renderProducts(); renderSide(); }

  $root.append(
    h('div', { class: 'order-menu' }, $top, h('div', { class: 'search' }, $search), $cats, h('div', { class: 'products-scroll' }, $products)),
    $side, $cartBar);
  renderCats();
  renderAll();
  fill($view, $root);
}

// ---------- cobro ----------
function checkout(initialOrder, onOrderChange) {
  let order = initialOrder;
  const methods = state.boot.methods;
  const local = {
    tipMode: 'ninguna',
    discountType: order.discount_type,
  };

  return openDialog((close, dialog) => {
    const $due = h('div', { class: 'due' });
    const $balance = h('p', { class: 'balance' });
    const $confirm = h('button', { class: 'btn pay', type: 'button' });
    const $tipCustom = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Valor de la propina', 'aria-label': 'Valor de la propina', oninput: refresh });
    const $discount = h('input', {
      type: 'text', inputmode: 'decimal', 'aria-label': 'Valor del descuento',
      value: order.discount_type === 'ninguno' ? '' : String(order.discount_value),
      onchange: applyDiscount,
    });
    const payInputs = Object.fromEntries(methods.map((m) => [m, h('input', {
      type: 'text', inputmode: 'numeric', placeholder: '0', 'aria-label': `Pago en ${METHOD_LABEL[m]}`, oninput: refresh,
    })]));

    const tip = () => {
      if (local.tipMode === 'sugerida') return order.totals.suggestedTip;
      if (local.tipMode === 'otra') return digits($tipCustom.value);
      return 0;
    };
    const total = () => order.totals.total + tip();
    const received = () => methods.reduce((a, m) => a + digits(payInputs[m].value), 0);

    const $tipSeg = h('div', { class: 'seg' });
    const $discSeg = h('div', { class: 'seg' });

    function renderSegs() {
      fill($tipSeg,
        [['ninguna', 'Sin propina'], ['sugerida', `${order.tip_rate} % sugerida: ${money(order.totals.suggestedTip)}`], ['otra', 'Otro valor']]
          .map(([mode, label]) => h('button', {
            type: 'button', class: local.tipMode === mode ? 'is-current' : '',
            onclick: () => { local.tipMode = mode; renderSegs(); refresh(); if (mode === 'otra') $tipCustom.focus(); },
          }, label)));
      $tipCustom.style.display = local.tipMode === 'otra' ? '' : 'none';
      fill($discSeg,
        [['ninguno', 'Sin descuento'], ['pct', 'Porcentaje'], ['valor', 'Valor en pesos']]
          .map(([type, label]) => h('button', {
            type: 'button', class: local.discountType === type ? 'is-current' : '',
            onclick: () => {
              local.discountType = type;
              $discount.value = '';
              renderSegs();
              if (type === 'ninguno') applyDiscount(); else $discount.focus();
            },
          }, label)));
      $discount.style.display = local.discountType === 'ninguno' ? 'none' : '';
      $discount.placeholder = local.discountType === 'pct' ? 'Porcentaje, por ejemplo 10' : 'Valor, por ejemplo 5000';
    }

    async function applyDiscount() {
      const value = local.discountType === 'pct'
        ? Number(String($discount.value).replace(',', '.')) || 0
        : digits($discount.value);
      const next = await attempt(() => api('PATCH', `/api/orders/${order.id}`, {
        discount_type: value > 0 ? local.discountType : 'ninguno', discount_value: value,
      }));
      if (next) { order = next; onOrderChange(next); renderSegs(); refresh(); }
    }

    function refresh() {
      const t = order.totals;
      const due = total();
      fill($due,
        h('div', { class: 'mini' }, h('span', null, 'Total a cobrar')),
        h('div', { class: 'big num' }, money(due)),
        t.discount > 0 && h('div', { class: 'mini' }, h('span', null, 'Descuento aplicado'), h('span', { class: 'num' }, `- ${money(t.discount)}`)),
        order.tax.rate > 0 && h('div', { class: 'mini' },
          h('span', null, `${order.tax.name} ${order.tax.rate} %${order.tax.included ? ' (incluido)' : ''}`), h('span', { class: 'num' }, money(t.tax))),
        tip() > 0 && h('div', { class: 'mini' }, h('span', null, 'Propina'), h('span', { class: 'num' }, money(tip()))));

      const got = received();
      const cash = digits(payInputs.efectivo.value);
      const change = got - due;
      let ok = false;
      if (due === 0) {
        $balance.textContent = 'La cuenta queda en cero. No hay nada que cobrar.';
        $balance.className = 'balance good';
        ok = got === 0;
      } else if (got === 0) {
        $balance.textContent = 'Escribe cuánto recibes en cada método de pago.';
        $balance.className = 'balance';
      } else if (change < 0) {
        $balance.textContent = `Faltan ${money(-change)}`;
        $balance.className = 'balance bad';
      } else if (change > cash) {
        $balance.textContent = 'La tarjeta y la transferencia no pueden superar el total.';
        $balance.className = 'balance bad';
      } else {
        $balance.textContent = change > 0 ? `Vuelto: ${money(change)}` : 'Pago completo, sin vuelto.';
        $balance.className = 'balance good';
        ok = true;
      }
      $confirm.disabled = !ok;
      $confirm.textContent = `Cobrar ${money(due)}`;
    }

    // "Todo" pone en ese método lo que falte para completar la cuenta.
    const fillRest = (method) => {
      const others = methods.filter((m) => m !== method).reduce((a, m) => a + digits(payInputs[m].value), 0);
      payInputs[method].value = String(Math.max(total() - others, 0));
      refresh();
    };

    $confirm.addEventListener('click', async () => {
      $confirm.disabled = true;
      const paid = await attempt(() => api('POST', `/api/orders/${order.id}/pay`, {
        tip: tip(),
        payments: methods.map((m) => ({ method: m, amount: digits(payInputs[m].value) })).filter((p) => p.amount > 0),
      }));
      if (!paid) { refresh(); return; }
      const change = paid.payments.reduce((a, p) => a + p.change, 0);
      fill(dialog, h('div', { class: 'dlg' },
        h('h2', null, `Venta N.° ${paid.number} cobrada`),
        h('div', { class: 'due' },
          h('div', { class: 'mini' }, h('span', null, change > 0 ? 'Vuelto para el cliente' : 'Total cobrado')),
          h('div', { class: 'big num' }, money(change > 0 ? change : paid.totals.total)),
          change > 0 && h('div', { class: 'mini' }, h('span', null, 'Total cobrado'), h('span', { class: 'num' }, money(paid.totals.total)))),
        h('div', { class: 'dlg-actions' },
          h('a', { class: 'btn', href: `/recibo/${paid.id}?imprimir=1`, target: '_blank', rel: 'noopener' }, 'Imprimir recibo'),
          h('button', { class: 'btn primary', onclick: () => { close(true); location.hash = '#/salon'; } }, 'Volver al salón'))));
      dialog.addEventListener('close', () => { location.hash = '#/salon'; }, { once: true });
    });

    renderSegs();
    refresh();

    return h('div', { class: 'dlg' },
      h('h2', null, initialOrder.type === 'llevar'
        ? `Cobrar pedido para llevar${initialOrder.label ? ` de ${initialOrder.label}` : ''}`
        : `Cobrar mesa ${initialOrder.table_name}`),
      $due,
      h('div', { class: 'block' }, h('div', { class: 'title' }, 'Propina voluntaria'), $tipSeg, $tipCustom),
      h('div', { class: 'block' }, h('div', { class: 'title' }, 'Descuento'), $discSeg, $discount),
      h('div', { class: 'block' },
        h('div', { class: 'title' }, 'Pago recibido'),
        methods.map((m) => h('div', { class: 'paygrid' },
          h('span', { class: 'mlabel' }, METHOD_LABEL[m]),
          payInputs[m],
          h('button', { type: 'button', class: 'btn small', onclick: () => fillRest(m) }, 'Todo'))),
        $balance),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => close(false) }, 'Volver al pedido'),
        $confirm));
  });
}

// ---------- ventas ----------
async function viewSales(isCurrent) {
  if (!state.boot) await loadBoot();
  if (!isCurrent()) return;
  const range = { from: todayStr(), to: todayStr() };
  const $body = h('div');
  const $export = h('a', { class: 'btn primary', download: true }, 'Exportar a Excel');

  const load = async () => {
    $export.href = `/api/export?from=${range.from}&to=${range.to}`;
    const data = await attempt(() => api('GET', `/api/sales?from=${range.from}&to=${range.to}`));
    if (!data || !isCurrent()) return;
    const s = data.summary;
    const sameDay = data.from === data.to;
    fill($body,
      h('div', { class: 'figures' },
        h('div', { class: 'figure main' }, h('div', { class: 'k' }, 'Total recaudado'), h('div', { class: 'v num' }, money(s.total))),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, 'Ventas'), h('div', { class: 'v num' }, s.count)),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, 'Promedio por venta'), h('div', { class: 'v num' }, money(s.average))),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, state.boot.settings.tax_name), h('div', { class: 'v num' }, money(s.tax))),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, 'Propinas'), h('div', { class: 'v num' }, money(s.tip)))),
      data.orders.length === 0
        ? h('p', { class: 'empty' }, sameDay
          ? 'No hay ventas cerradas en esta fecha. Las cuentas aparecen aquí cuando se cobran.'
          : 'No hay ventas cerradas en este rango de fechas.')
        : h('div', { class: 'split' },
          h('div', { class: 'scroll-x' }, h('table', { class: 'grid' },
            h('thead', null, h('tr', null,
              h('th', null, 'N.°'), h('th', null, sameDay ? 'Hora' : 'Fecha'), h('th', null, 'Mesa o cliente'),
              h('th', { class: 'r' }, 'Total'), h('th', null, 'Estado'), h('th', null, ''))),
            h('tbody', null, [...data.orders].reverse().map((o) => h('tr', null,
              h('td', { class: 'num' }, o.number ?? ''),
              h('td', { class: 'num' }, sameDay ? clock(o.closed_at) : dayAndClock(o.closed_at)),
              h('td', null, o.type === 'llevar' ? `Para llevar${o.label ? `: ${o.label}` : ''}` : `Mesa ${o.table_name}`),
              h('td', { class: 'r num' }, money(o.total)),
              h('td', null, o.status === 'pagada' ? h('span', { class: 'tag' }, 'Pagada') : h('span', { class: 'tag bad', title: o.cancel_reason || '' }, 'Anulada')),
              h('td', { class: 'r' }, h('a', { class: 'linkish', href: `/recibo/${o.id}`, target: '_blank', rel: 'noopener' }, 'Ver recibo'))))))),
          h('div', null,
            h('div', { class: 'panel' },
              h('h2', null, 'Recaudo por método'),
              h('div', { class: 'admin-list' }, Object.entries(s.byMethod).map(([m, amount]) => h('div', { class: 'admin-row' },
                h('span', { class: 'grow' }, METHOD_LABEL[m] || m), h('strong', { class: 'num' }, money(amount)))))),
            s.byProduct.length > 0 && h('div', { class: 'panel' },
              h('h2', null, 'Lo más vendido'),
              h('div', { class: 'admin-list' }, s.byProduct.slice(0, 8).map((p) => h('div', { class: 'admin-row' },
                h('span', { class: 'grow' }, p.name, ' ', h('span', { class: 'muted num' }, `× ${p.qty}`)),
                h('strong', { class: 'num' }, money(p.amount)))))))),
    );
  };

  const dateField = (label, key) => h('label', { class: 'field' }, label, h('input', {
    type: 'date', value: range[key], max: todayStr(),
    onchange: (e) => {
      range[key] = e.target.value || todayStr();
      if (range.to < range.from) { if (key === 'from') range.to = range.from; else range.from = range.to; }
      $from.querySelector('input').value = range.from;
      $to.querySelector('input').value = range.to;
      load();
    },
  }));
  const $from = dateField('Desde', 'from');
  const $to = dateField('Hasta', 'to');

  fill($view,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Ventas'), h('p', { class: 'sub' }, 'Cuentas cobradas y anuladas, con exportación a Excel.')),
      $export),
    h('div', { class: 'filters' }, $from, $to),
    $body);
  await load();
}

// ---------- notas ----------
async function viewNotes(isCurrent) {
  if (!state.boot) await loadBoot();
  const $list = h('div');
  const $text = h('textarea', {
    maxlength: 600, 'aria-label': 'Nueva nota',
    placeholder: 'Por ejemplo: pedir gaseosas al proveedor, la mesa 4 dejó un abono de $ 20.000, falta cambio en caja',
  });

  const render = (notes) => {
    if (!isCurrent()) return;
    const pending = notes.filter((n) => !n.done);
    const done = notes.filter((n) => n.done);
    setNotesCount(pending.length);
    const act = (fn) => async () => { const data = await attempt(fn); if (data) render(data.notes); };
    const card = (n) => h('article', { class: `note${n.done ? ' is-done' : ''}` },
      h('p', { class: 'body' }, n.body),
      h('p', { class: 'when' }, `${n.done ? 'Hecha' : 'Escrita'} el ${dayAndClock(n.done ? n.updated_at : n.created_at)}`),
      h('div', { class: 'tools' },
        h('button', { class: 'btn small quiet', onclick: act(() => api('PATCH', `/api/notes/${n.id}`, { done: !n.done })) }, n.done ? 'Volver a pendiente' : 'Marcar como hecha'),
        !n.done && h('button', {
          class: 'btn small quiet',
          onclick: async () => {
            const data = await formDialog({
              title: 'Editar nota',
              fields: [{ name: 'body', label: 'Texto de la nota', type: 'textarea', value: n.body, maxlength: 600 }],
              submitLabel: 'Guardar cambios',
              onSubmit: (v) => api('PATCH', `/api/notes/${n.id}`, { body: v.body }),
            });
            if (data) render(data.notes);
          },
        }, 'Editar'),
        h('button', {
          class: 'btn small quiet',
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Borrar esta nota', text: 'No se puede recuperar después.', confirmLabel: 'Borrar nota', danger: true }))) return;
            const data = await attempt(() => api('DELETE', `/api/notes/${n.id}`));
            if (data) render(data.notes);
          },
        }, 'Borrar')));
    fill($list,
      pending.length
        ? h('div', { class: 'notes' }, pending.map(card))
        : h('p', { class: 'empty', style: 'max-width:760px' }, 'No hay notas pendientes. Escribe arriba lo que caja o administración deban recordar.'),
      done.length > 0 && [h('h2', { class: 'notes-sub' }, 'Hechas'), h('div', { class: 'notes' }, done.map(card))]);
  };

  const save = async () => {
    const body = $text.value.trim();
    if (!body) { toast('Escribe el texto de la nota.', true); $text.focus(); return; }
    const data = await attempt(() => api('POST', '/api/notes', { body }));
    if (data) { $text.value = ''; render(data.notes); toast('Nota guardada'); }
  };

  fill($view,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Notas'), h('p', { class: 'sub' }, 'Recordatorios de caja y administración. Las ve todo el que abra el POS.'))),
    h('div', { class: 'note-new' }, $text, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Guardar nota'))),
    $list);
  const data = await attempt(() => api('GET', '/api/notes'));
  if (data) render(data.notes);
}

// ---------- menú ----------
async function viewMenu(isCurrent) {
  const reload = async () => {
    const boot = await loadBoot();
    if (!isCurrent()) return;
    const catOptions = boot.categories.map((c) => ({ value: c.id, label: c.name }));

    const productForm = (product, categoryId) => formDialog({
      title: product ? 'Editar producto' : 'Nuevo producto',
      fields: [
        { name: 'name', label: 'Nombre', value: product?.name, maxlength: 60 },
        { name: 'price', label: 'Precio en pesos', type: 'number', value: product?.price, hint: state.boot.settings.tax_included ? 'Con el impuesto ya incluido' : 'Sin impuesto' },
        { name: 'description', label: 'Descripción', hint: 'Opcional. Ingredientes o lo que incluye', value: product?.description, maxlength: 160 },
        { name: 'category_id', label: 'Categoría', type: 'select', value: product?.category_id ?? categoryId, options: catOptions },
      ],
      submitLabel: product ? 'Guardar cambios' : 'Agregar producto',
      onSubmit: (v) => api(product ? 'PUT' : 'POST', product ? `/api/products/${product.id}` : '/api/products', v),
    }).then((r) => r && reload());

    const categoryForm = (cat) => formDialog({
      title: cat ? 'Renombrar categoría' : 'Nueva categoría',
      fields: [{ name: 'name', label: 'Nombre', value: cat?.name, maxlength: 40 }],
      submitLabel: cat ? 'Guardar cambios' : 'Crear categoría',
      onSubmit: (v) => api(cat ? 'PUT' : 'POST', cat ? `/api/categories/${cat.id}` : '/api/categories', v),
    }).then((r) => r && reload());

    const remove = async (url, title, text) => {
      if (!(await confirmDialog({ title, text, confirmLabel: 'Quitar', danger: true }))) return;
      if (await attempt(() => api('DELETE', url))) reload();
    };

    fill($view,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Menú'), h('p', { class: 'sub' }, (() => {
          const out = boot.products.filter((p) => !p.available).length;
          if (!out) return 'Todos los productos están disponibles. Si algo se acaba, márcalo como no disponible.';
          return out === 1 ? 'Hay 1 producto marcado como no disponible.' : `Hay ${out} productos marcados como no disponibles.`;
        })())),
        h('button', { class: 'btn primary', onclick: () => categoryForm() }, 'Nueva categoría')),
      boot.categories.length === 0 && h('p', { class: 'empty' }, 'El menú está vacío. Crea una categoría para empezar a agregar productos.'),
      boot.categories.map((c) => {
        const products = boot.products.filter((p) => p.category_id === c.id);
        return h('section', { class: 'cat-block' },
          h('div', { class: 'cat-head' },
            h('h2', null, c.name),
            h('button', { class: 'btn small', onclick: () => productForm(null, c.id) }, 'Agregar producto'),
            h('button', { class: 'btn small quiet', onclick: () => categoryForm(c) }, 'Renombrar'),
            h('button', { class: 'btn small quiet', onclick: () => remove(`/api/categories/${c.id}`, `Quitar la categoría ${c.name}`) }, 'Quitar')),
          h('div', { class: 'admin-list' }, products.length
            ? products.map((p) => h('div', { class: `admin-row${p.available ? '' : ' is-out'}` },
              h('span', { class: 'grow' }, p.name, ' ', !p.available && h('span', { class: 'tag bad' }, 'No disponible'),
                p.description && h('div', { class: 'muted' }, p.description)),
              h('strong', { class: 'num' }, money(p.price)),
              h('button', {
                class: `btn small ${p.available ? '' : 'primary'}`,
                onclick: async () => {
                  const ok = await attempt(() => api('PATCH', `/api/products/${p.id}/availability`, { available: !p.available }));
                  if (ok) { toast(p.available ? `${p.name} quedó como no disponible` : `${p.name} vuelve a estar disponible`); reload(); }
                },
              }, p.available ? 'Marcar no disponible' : 'Marcar disponible'),
              h('button', { class: 'btn small quiet', onclick: () => productForm(p) }, 'Editar'),
              h('button', { class: 'btn small quiet', onclick: () => remove(`/api/products/${p.id}`, `Quitar ${p.name} del menú`, 'Las ventas ya registradas con este producto no cambian.') }, 'Quitar')))
            : h('p', { class: 'muted', style: 'padding:10px 0' }, 'Sin productos todavía.')));
      }));
  };
  await reload();
}

// ---------- ajustes ----------
async function viewSettings(isCurrent) {
  const reload = async () => {
    const boot = await loadBoot();
    if (!isCurrent()) return;
    const s = boot.settings;
    const zoneOptions = boot.zones.map((z) => ({ value: z.id, label: z.name }));

    const input = (name, label, value, opts = {}) => h('label', { class: 'field' }, label,
      opts.hint && h('span', { class: 'hint' }, opts.hint),
      h('input', { type: 'text', name, value: value ?? '', inputmode: opts.numeric ? 'decimal' : null, maxlength: opts.max || null, autocomplete: 'off' }));

    const $included = h('input', { type: 'checkbox', name: 'tax_included', checked: s.tax_included });
    const form = h('form', { class: 'panel', novalidate: true },
      h('h2', null, 'Datos del negocio y del recibo'),
      h('div', { class: 'form-grid' },
        input('business_name', 'Nombre del negocio', s.business_name, { max: 80 }),
        input('business_nit', 'NIT', s.business_nit, { max: 40 }),
        input('business_address', 'Dirección', s.business_address, { max: 120 }),
        input('business_phone', 'Teléfono', s.business_phone, { max: 40 }),
        input('receipt_footer', 'Mensaje al final del recibo', s.receipt_footer, { max: 160 })),
      h('h2', { style: 'margin-top:22px' }, 'Impuesto y propina'),
      h('div', { class: 'form-grid' },
        input('tax_name', 'Nombre del impuesto', s.tax_name, { max: 30 }),
        input('tax_rate', 'Porcentaje de impuesto', s.tax_rate, { numeric: true, hint: 'Escribe 0 si no aplica' }),
        input('tip_rate', 'Porcentaje de propina sugerida', s.tip_rate, { numeric: true, hint: 'Siempre es voluntaria' })),
      h('label', { class: 'check', style: 'margin-top:14px' }, $included, 'Los precios del menú ya incluyen el impuesto'),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn primary', type: 'submit' }, 'Guardar ajustes')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const num = (k) => Number(String(fd.get(k)).replace(',', '.'));
      const saved = await attempt(() => api('PUT', '/api/settings', {
        business_name: fd.get('business_name'), business_nit: fd.get('business_nit'),
        business_address: fd.get('business_address'), business_phone: fd.get('business_phone'),
        receipt_footer: fd.get('receipt_footer'), tax_name: fd.get('tax_name'),
        tax_rate: num('tax_rate'), tip_rate: num('tip_rate'), tax_included: $included.checked,
      }));
      if (saved) { toast('Ajustes guardados'); reload(); }
    });

    const tableForm = (table, zoneId) => formDialog({
      title: table ? `Editar mesa ${table.name}` : 'Nueva mesa',
      fields: [
        { name: 'name', label: 'Nombre o número', value: table?.name, maxlength: 12 },
        { name: 'seats', label: 'Puestos', type: 'number', value: table?.seats ?? 4 },
        { name: 'zone_id', label: 'Zona', type: 'select', value: table?.zone_id ?? zoneId, options: zoneOptions },
      ],
      submitLabel: table ? 'Guardar cambios' : 'Crear mesa',
      onSubmit: (v) => api(table ? 'PUT' : 'POST', table ? `/api/tables/${table.id}` : '/api/tables', v),
    }).then((r) => r && reload());

    const zoneForm = (zone) => formDialog({
      title: zone ? 'Renombrar zona' : 'Nueva zona',
      fields: [{ name: 'name', label: 'Nombre', value: zone?.name, maxlength: 40, placeholder: 'Por ejemplo: Terraza' }],
      submitLabel: zone ? 'Guardar cambios' : 'Crear zona',
      onSubmit: (v) => api(zone ? 'PUT' : 'POST', zone ? `/api/zones/${zone.id}` : '/api/zones', v),
    }).then((r) => r && reload());

    const remove = async (url, title) => {
      if (!(await confirmDialog({ title, confirmLabel: 'Quitar', danger: true }))) return;
      if (await attempt(() => api('DELETE', url))) reload();
    };

    fill($view,
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Ajustes'))),
      form,
      h('div', { class: 'panel' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' },
          h('h2', null, 'Zonas y mesas'),
          h('button', { class: 'btn small primary', onclick: () => zoneForm() }, 'Nueva zona')),
        boot.zones.length === 0 && h('p', { class: 'empty' }, 'Crea una zona, por ejemplo "Salón", y luego agrégale mesas.'),
        boot.zones.map((z) => {
          const tables = boot.tables.filter((t) => t.zone_id === z.id);
          return h('section', { class: 'cat-block' },
            h('div', { class: 'cat-head' },
              h('h2', null, z.name),
              h('button', { class: 'btn small', onclick: () => tableForm(null, z.id) }, 'Agregar mesa'),
              h('button', { class: 'btn small quiet', onclick: () => zoneForm(z) }, 'Renombrar'),
              h('button', { class: 'btn small quiet', onclick: () => remove(`/api/zones/${z.id}`, `Quitar la zona ${z.name}`) }, 'Quitar')),
            h('div', { class: 'admin-list' }, tables.length
              ? tables.map((t) => h('div', { class: 'admin-row' },
                h('span', { class: 'grow' }, h('strong', null, `Mesa ${t.name}`), ' ', h('span', { class: 'muted' }, `${t.seats} ${t.seats === 1 ? 'puesto' : 'puestos'}`)),
                h('button', { class: 'btn small quiet', onclick: () => tableForm(t) }, 'Editar'),
                h('button', { class: 'btn small quiet', onclick: () => remove(`/api/tables/${t.id}`, `Quitar la mesa ${t.name}`) }, 'Quitar')))
              : h('p', { class: 'muted', style: 'padding:10px 0' }, 'Sin mesas todavía.')));
        })));
  };
  await reload();
}

// ---------- rutas ----------
async function route() {
  const id = ++state.renderId;
  const isCurrent = () => id === state.renderId;
  clearInterval(state.poll);
  state.poll = null;
  document.querySelectorAll('dialog[open]').forEach((d) => { d.close(); d.remove(); });

  const [, name = 'salon', arg] = location.hash.split('/');
  const nav = name === 'pedido' ? 'salon' : name;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const current = a.dataset.nav === nav;
    a.classList.toggle('is-current', current);
    if (current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $view.classList.remove('is-order');

  try {
    if (name === 'pedido' && Number(arg) > 0) await viewOrder(isCurrent, Number(arg));
    else if (name === 'ventas') await viewSales(isCurrent);
    else if (name === 'notas') await viewNotes(isCurrent);
    else if (name === 'menu') await viewMenu(isCurrent);
    else if (name === 'ajustes') await viewSettings(isCurrent);
    else await viewSalon(isCurrent);
  } catch (err) {
    if (isCurrent()) fill($view, h('p', { class: 'empty' }, err.message));
  }
}

window.addEventListener('hashchange', route);
// El contador de notas pendientes se muestra en cualquier pantalla, no solo en el salón.
api('GET', '/api/salon').then((d) => setNotesCount(d.pending_notes)).catch(() => {});
route();
