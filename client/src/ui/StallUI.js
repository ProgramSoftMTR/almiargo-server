import { ITEMS } from '@almiargo/shared';
import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { drawItemIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

/**
 * Tienda de jugador (AFK). Tres modos:
 *  - view:   examinar y comprar listados de otra tienda.
 *  - editor: elegir ítems de la mochila y fijar precios.
 *  - own:    ver/cerrar la propia tienda abierta.
 */
export class StallUI {
  constructor() {
    this.panel = $('stallPanel');
    this.mode = 'view';
    this.viewing = null;
    this.refreshTimer = null;
    this.bind();
    this.subscribe();
  }

  bind() {
    for (const btn of document.querySelectorAll('[data-close="stallPanel"]')) {
      btn.addEventListener('click', () => this.close());
    }
    $('btnPublishStall').addEventListener('click', () => this.publish());
    $('btnCloseStall').addEventListener('click', () => this.closeMine());
    $('stallItems').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-buy-listing]');
      if (!btn || btn.disabled) return;
      this.buyListing(btn.dataset.buyListing, btn);
    });
  }

  subscribe() {
    store.on('game-event', (msg) => {
      if (msg.event === 'stall' && msg.stall) this.openView(msg.stall);
      if (msg.event === 'stall_closed' && this.mode === 'view' && this.viewing?.id === msg.stallId) {
        this.close();
        this.toast('La tienda se quedó vacía.', '');
      }
    });
    store.on('profile', () => this.onProfile());
  }

  onProfile() {
    if (this.panel.classList.contains('hidden')) return;
    if (this.mode === 'editor' && store.player?.inStall) {
      this.openOwn();
      this.toast('Tienda publicada. Tu personaje queda inmóvil.', '');
      return;
    }
    if (this.mode === 'own') {
      if (!store.player?.inStall) {
        this.close();
        this.toast('Tienda cerrada; los ítems volvieron a tu mochila.', '');
      } else {
        this.renderOwn();
      }
    }
  }

  // ── Modos ────────────────────────────────────────────────────
  openEditor() {
    if (!store.player) return;
    if (store.player.inStall) {
      this.openOwn();
      return;
    }
    this.mode = 'editor';
    this.viewing = null;
    this.panel.classList.remove('hidden');
    $('stallTitle').textContent = 'Abrir tienda';
    $('stallInfo').textContent = 'Marca los ítems y fija un precio por lote. Sólo puedes abrir tienda en la ciudad.';
    $('stallEditor').classList.remove('hidden');
    $('btnPublishStall').classList.remove('hidden');
    $('btnCloseStall').classList.add('hidden');
    this.renderEditor();
  }

  openOwn() {
    if (!store.player) return;
    this.mode = 'own';
    this.viewing = null;
    this.panel.classList.remove('hidden');
    $('stallTitle').textContent = 'Mi tienda';
    $('stallEditor').classList.add('hidden');
    $('btnPublishStall').classList.add('hidden');
    $('btnCloseStall').classList.remove('hidden');
    this.renderOwn();
  }

  openView(stall) {
    this.mode = 'view';
    this.viewing = stall;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.panel.classList.remove('hidden');
    $('stallTitle').textContent = `Tienda de ${stall.ownerName ?? 'jugador'}`;
    $('stallInfo').textContent = 'Los precios los fija el dueño. La compra se valida en el servidor.';
    $('stallEditor').classList.add('hidden');
    $('btnPublishStall').classList.add('hidden');
    $('btnCloseStall').classList.add('hidden');
    this.renderView();
  }

  close() {
    this.panel.classList.add('hidden');
    this.viewing = null;
    this.mode = 'view';
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  // ── Render ───────────────────────────────────────────────────
  renderEditor() {
    const list = $('stallListEditor');
    list.textContent = '';
    const inventory = store.player?.inventory ?? [];
    let shown = 0;
    for (const inst of inventory) {
      if (!inst) continue;
      const def = ITEMS[inst.itemId];
      if (!def) continue;
      shown += 1;

      const row = document.createElement('label');
      row.className = 'stall-editor-row';
      row.dataset.uid = inst.uid;

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.uid = inst.uid;
      row.appendChild(check);

      const canvas = document.createElement('canvas');
      drawItemIcon(canvas, def, 24);
      row.appendChild(canvas);

      const name = document.createElement('span');
      name.textContent = `${def.name}${inst.qty > 1 ? ` x${inst.qty}` : ''}`;
      row.appendChild(name);

      const price = document.createElement('input');
      price.type = 'number';
      price.min = '1';
      price.max = '100000000';
      price.step = '1';
      price.value = String(Math.max(1, Math.round((def.sell ?? def.price ?? 10) * 2)));
      price.dataset.uid = inst.uid;
      price.disabled = true;
      price.setAttribute('aria-label', `Precio de ${def.name}`);
      row.appendChild(price);

      check.addEventListener('change', () => {
        price.disabled = !check.checked;
        row.classList.toggle('selected', check.checked);
      });

      list.appendChild(row);
    }

    if (shown === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Tu mochila está vacía.';
      list.appendChild(empty);
    }
  }

  renderOwn() {
    const list = $('stallItems');
    list.textContent = '';
    const items = store.player?.stall?.items ?? [];
    const owner = store.player?.name ?? '';
    $('stallInfo').textContent = items.length
      ? 'Tu personaje permanece inmóvil mientras la tienda está abierta. Los compradores pagan el precio fijado.'
      : 'Tu tienda está abierta pero vacía.';
    if (items.length === 0) return;
    for (const listing of items) {
      list.appendChild(this.listingRow(listing, owner, false));
    }
  }

  renderView() {
    const list = $('stallItems');
    list.textContent = '';
    const stall = this.viewing;
    if (!stall) return;
    const items = stall.items ?? [];
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Esta tienda está vacía.';
      list.appendChild(empty);
      return;
    }
    const mine = stall.id === `stall_${store.player?.id}`;
    for (const listing of items) {
      list.appendChild(this.listingRow(listing, stall.ownerName ?? '', !mine));
    }
  }

  listingRow(listing, owner, canBuy) {
    const def = ITEMS[listing.itemId];
    const row = document.createElement('div');
    row.className = 'shop-row';

    const canvas = document.createElement('canvas');
    drawItemIcon(canvas, def ?? { icon: { shape: 'misc', color: 0xaaaaaa } }, 28);
    row.appendChild(canvas);

    const nameBox = document.createElement('div');
    nameBox.className = 'shop-name';
    const name = document.createElement('b');
    name.textContent = def?.name ?? listing.itemId;
    const info = document.createElement('small');
    info.textContent = `${listing.qty > 1 ? `x${listing.qty} · ` : ''}${owner}`;
    nameBox.appendChild(name);
    nameBox.appendChild(info);
    row.appendChild(nameBox);

    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = `${listing.price}◈`;
    row.appendChild(price);

    if (canBuy) {
      const btn = document.createElement('button');
      btn.className = 'buy-btn';
      btn.dataset.buyListing = listing.uid;
      btn.textContent = 'Comprar';
      const gold = store.player?.gold ?? 0;
      btn.disabled = gold < listing.price;
      row.appendChild(btn);
    } else {
      const tag = document.createElement('span');
      tag.className = 'muted';
      tag.textContent = 'En venta';
      row.appendChild(tag);
    }
    return row;
  }

  // ── Acciones ─────────────────────────────────────────────────
  publish() {
    const rows = $('stallListEditor').querySelectorAll('.stall-editor-row');
    const items = [];
    for (const row of rows) {
      const check = row.querySelector('input[type="checkbox"]');
      if (!check?.checked) continue;
      const uid = row.dataset.uid;
      const priceInput = row.querySelector('input[type="number"]');
      const price = Math.floor(Number(priceInput?.value));
      if (!uid || !Number.isFinite(price) || price < 1 || price > 100_000_000) {
        this.toast('Precio inválido: usa un número entre 1 y 100.000.000', 'error');
        priceInput?.focus();
        return;
      }
      items.push({ uid, price });
    }
    if (items.length === 0) {
      this.toast('Selecciona al menos un ítem para vender', 'error');
      return;
    }
    socket.send('stall_open', { items });
  }

  closeMine() {
    socket.send('stall_close', {});
  }

  buyListing(itemUid, btn) {
    if (!this.viewing) return;
    const stallId = this.viewing.id;
    btn.disabled = true;
    btn.textContent = '…';
    socket.send('stall_buy', { stallId, itemUid });
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.mode === 'view' && this.viewing?.id === stallId && !this.panel.classList.contains('hidden')) {
        socket.send('stall_view', { id: stallId });
      }
    }, 600);
  }

  toast(text, type) {
    uiBus.emit('toast', { text, type });
  }
}
