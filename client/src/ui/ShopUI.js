import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { drawItemIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

/**
 * Tienda de NPC. El servidor manda el catálogo y valida cada compra;
 * aquí sólo se presenta y se envían intenciones.
 */
export class ShopUI {
  constructor() {
    this.panel = $('shopPanel');
    this.shop = null;
    this.bind();
    this.subscribe();
  }

  bind() {
    for (const btn of document.querySelectorAll('[data-close="shopPanel"]')) {
      btn.addEventListener('click', () => this.close());
    }
    $('shopItems').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-buy]');
      if (!btn) return;
      this.buy(btn.dataset.buy, Number(btn.dataset.qty) || 1);
    });
  }

  subscribe() {
    store.on('game-event', (msg) => {
      if (msg.event === 'shop' && msg.shop) this.open(msg.shop);
    });
    store.on('profile', () => {
      if (!this.panel.classList.contains('hidden')) this.render();
    });
  }

  open(shop) {
    this.shop = shop;
    this.panel.classList.remove('hidden');
    $('shopTitle').textContent = shop.name || 'Mercader';
    this.render();
  }

  close() {
    this.panel.classList.add('hidden');
    this.shop = null;
  }

  toggle() {
    if (this.panel.classList.contains('hidden')) {
      if (this.shop) this.open(this.shop);
    } else {
      this.close();
    }
  }

  buy(itemId, qty) {
    if (!this.shop) return;
    socket.send('shop_buy', { npcId: this.shop.npcId, itemId, qty });
  }

  render() {
    const shop = this.shop;
    const list = $('shopItems');
    list.textContent = '';
    $('shopGold').textContent = `Oro: ${store.player?.gold ?? 0}`;
    if (!shop || !Array.isArray(shop.items) || shop.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Este mercader no tiene nada a la venta.';
      list.appendChild(empty);
      return;
    }

    const level = store.player?.level ?? 1;
    const gold = store.player?.gold ?? 0;

    for (const item of shop.items) {
      const row = document.createElement('div');
      row.className = 'shop-row';

      const canvas = document.createElement('canvas');
      drawItemIcon(canvas, item, 28);
      row.appendChild(canvas);

      const nameBox = document.createElement('div');
      nameBox.className = 'shop-name';
      const name = document.createElement('b');
      name.textContent = item.name;
      const info = document.createElement('small');
      const bits = [];
      if (item.levelReq > 1) bits.push(`Nv. ${item.levelReq}`);
      if (item.stats?.atkMin) bits.push(`ATK ${item.stats.atkMin}-${item.stats.atkMax}`);
      if (item.stats?.defense) bits.push(`DEF +${item.stats.defense}`);
      if (item.stats?.maxHp) bits.push(`HP +${item.stats.maxHp}`);
      if (item.stats?.maxMp) bits.push(`MP +${item.stats.maxMp}`);
      info.textContent = bits.join(' · ') || (item.description ?? '');
      nameBox.appendChild(name);
      nameBox.appendChild(info);
      row.appendChild(nameBox);

      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = `${item.price}◈`;
      row.appendChild(price);

      const buy1 = document.createElement('button');
      buy1.className = 'buy-btn';
      buy1.dataset.buy = item.id;
      buy1.dataset.qty = '1';
      buy1.textContent = 'x1';
      buy1.disabled = level < (item.levelReq ?? 1) || gold < item.price;
      row.appendChild(buy1);

      if (item.stackable) {
        const buy5 = document.createElement('button');
        buy5.className = 'buy-btn';
        buy5.dataset.buy = item.id;
        buy5.dataset.qty = '5';
        buy5.textContent = 'x5';
        buy5.disabled = level < (item.levelReq ?? 1) || gold < item.price * 5;
        row.appendChild(buy5);
      }

      list.appendChild(row);
    }
  }

  toast(text, type) {
    uiBus.emit('toast', { text, type });
  }
}
