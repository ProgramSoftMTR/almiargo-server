import { CLASSES, EQUIP_SLOTS, ITEMS } from '@almiargo/shared';
import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { drawItemIcon, slotLabel } from './icons.js';

const $ = (id) => document.getElementById(id);

export class InventoryUI {
  constructor({ onStall }) {
    this.onStall = onStall;
    this.panel = $('inventoryPanel');
    this.selectedUid = null;
    this.page = 0;
    this.pageSize = 15;
    this.bind();
    this.subscribe();
  }

  bind() {
    for (const btn of document.querySelectorAll('[data-close="inventoryPanel"]')) {
      btn.addEventListener('click', () => this.close());
    }
    for (const tab of document.querySelectorAll('.inv-tab')) {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.inv-tab').forEach((t) => t.classList.toggle('active', t === tab));
        uiBus.emit('toast', { text: 'Sección próximamente', type: '' });
      });
    }
    // Drag and drop entre mochila y equipamiento.
    const equipGrid = $('equipmentGrid');
    const invGrid = $('inventoryGrid');
    const handleDragStart = (e) => {
      const slot = e.target.closest('.inv-slot, .equip-slot');
      if (!slot) return;
      if (slot.classList.contains('inv-slot') && slot.dataset.uid) {
        e.dataTransfer.setData('text/plain', `inv:${slot.dataset.uid}`);
        e.dataTransfer.effectAllowed = 'move';
      } else if (slot.classList.contains('equip-slot') && slot.classList.contains('filled')) {
        e.dataTransfer.setData('text/plain', `equip:${slot.dataset.slot}`);
        e.dataTransfer.effectAllowed = 'move';
      } else {
        e.preventDefault();
      }
    };
    const handleDragOver = (e) => {
      const slot = e.target.closest('.inv-slot, .equip-slot');
      if (slot) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    };
    const handleDrop = (e) => {
      const slot = e.target.closest('.inv-slot, .equip-slot');
      if (!slot) return;
      e.preventDefault();
      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;
      if (slot.classList.contains('equip-slot') && data.startsWith('inv:')) {
        socket.send('equip', { uid: data.slice(4) });
      } else if (slot.classList.contains('inv-slot') && data.startsWith('equip:')) {
        socket.send('unequip', { slot: data.slice(6) });
      }
      this.render();
    };
    equipGrid.addEventListener('dragstart', handleDragStart);
    invGrid.addEventListener('dragstart', handleDragStart);
    equipGrid.addEventListener('dragover', handleDragOver);
    invGrid.addEventListener('dragover', handleDragOver);
    equipGrid.addEventListener('drop', handleDrop);
    invGrid.addEventListener('drop', handleDrop);
    $('inventoryGrid').addEventListener('click', (e) => {
      const slot = e.target.closest('.inv-slot');
      if (!slot || !slot.dataset.uid) { this.select(null); return; }
      const item = store.itemByUid(slot.dataset.uid);
      const def = item ? ITEMS[item.itemId] : null;
      if (def?.slot && EQUIP_SLOTS.includes(def.slot)) {
        socket.send('equip', { uid: slot.dataset.uid });
        this.select(null);
        return;
      }
      this.select(slot.dataset.uid);
    });
    $('equipmentGrid').addEventListener('click', (e) => {
      const slot = e.target.closest('.equip-slot');
      if (!slot || !slot.dataset.slot || !slot.classList.contains('filled')) return;
      socket.send('unequip', { slot: slot.dataset.slot });
    });
    $('btnEquip').addEventListener('click', () => {
      if (!this.selectedUid) return;
      socket.send('equip', { uid: this.selectedUid });
    });
    $('btnUse').addEventListener('click', () => {
      if (!this.selectedUid) return;
      socket.send('use_item', { uid: this.selectedUid });
    });
    $('btnSell').addEventListener('click', () => {
      if (!this.selectedUid) return;
      const item = store.itemByUid(this.selectedUid);
      if (!item) return;
      socket.send('shop_sell', { uid: item.uid, qty: item.qty });
      this.select(null);
    });
    $('btnDrop').addEventListener('click', () => {
      if (!this.selectedUid) return;
      const item = store.itemByUid(this.selectedUid);
      if (!item) return;
      socket.send('drop', { uid: item.uid, qty: item.qty });
      this.select(null);
    });
    const prevBtn = $('invPrev');
    const nextBtn = $('invNext');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (this.page > 0) { this.page -= 1; this.render(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      const p = store.player;
      if (!p) return;
      const maxPage = Math.max(0, Math.ceil(p.inventory.length / this.pageSize) - 1);
      if (this.page < maxPage) { this.page += 1; this.render(); }
    });
  }

  subscribe() {
    store.on('profile', () => {
      if (!this.panel.classList.contains('hidden')) this.render();
    });
    store.on('snapshot', () => {
      if (!this.panel.classList.contains('hidden')) this.renderBarsOnly();
    });
  }

  open() {
    if (!store.player) return;
    this.page = 0;
    this.panel.classList.remove('hidden');
    this.render();
  }

  close() {
    this.panel.classList.add('hidden');
    this.selectedUid = null;
  }

  toggle() {
    if (this.panel.classList.contains('hidden')) this.open(); else this.close();
  }

  toast(text, type) {
    uiBus.emit('toast', { text, type });
  }

  renderBarsOnly() {
    const p = store.player;
    if (!p) return;
  }

  render() {
    const p = store.player;
    if (!p) return;
    this.selectedUid = p.inventory.some((i) => i?.uid === this.selectedUid) ? this.selectedUid : null;

    const className = (CLASSES[p.classId] ?? CLASSES.knight).name;

    const invLevel = $('invLevel');
    if (invLevel) invLevel.textContent = p.level ?? 1;
    const invDef = $('invDef');
    if (invDef) invDef.textContent = p.stats?.defense ?? 0;
    const invAtk = $('invAtk');
    if (invAtk) invAtk.textContent = p.stats?.bonusAtk ?? 0;
    const invClass = $('invClass');
    if (invClass) invClass.textContent = className;
    const invFree = $('invFree');
    if (invFree) invFree.textContent = `${p.inventory?.length ?? 0} items`;

    const eq = $('equipmentGrid');
    eq.textContent = '';
    const EQUIP_ORDER = ['mano','shield','helmet','armor','legs','boots','ring','amulet'];
    for (const slot of EQUIP_ORDER) {
      const inst = p.equipment?.[slot];
      const div = document.createElement('div');
      div.className = `equip-slot${inst ? ' filled' : ''}`;
      div.dataset.slot = slot;
      if (inst) div.draggable = true;
      if (inst) {
        const def = ITEMS[inst.itemId];
        const canvas = document.createElement('canvas');
        drawItemIcon(canvas, def, 28);
        div.appendChild(canvas);
        const name = document.createElement('span');
        name.className = 'slot-name';
        name.textContent = slotLabel(slot);
        div.appendChild(name);
        if (slot === 'mano') {
          const lvl = document.createElement('span');
          lvl.className = 'qty';
          lvl.textContent = 'Lv. ' + (store.player?.level ?? 1);
          div.appendChild(lvl);
        }
        div.title = `${def?.name ?? inst.itemId} (toca para quitar)`;
      } else {
        const name = document.createElement('span');
        name.className = 'slot-name';
        name.textContent = slotLabel(slot);
        div.appendChild(name);
      }
      if (!inst) {
        const canvas = document.createElement('canvas');
        drawItemIcon(canvas, { icon: { shape: 'misc', color: 0x5a6a6a } }, 28);
        canvas.style.opacity = '0.35';
        div.appendChild(canvas);
      }
      eq.appendChild(div);
    }

    const grid = $('inventoryGrid');
    grid.textContent = '';
    const start = this.page * this.pageSize;
    const pageSlots = p.inventory.slice(start, start + this.pageSize);
    pageSlots.forEach((inst, index) => {
      const btn = document.createElement('button');
      btn.className = `inv-slot${inst ? ' filled' : ''}${inst?.uid === this.selectedUid ? ' selected' : ''}`;
      btn.type = 'button';
      if (inst) {
        btn.draggable = true;
        btn.dataset.uid = inst.uid;
        const def = ITEMS[inst.itemId];
        const canvas = document.createElement('canvas');
        drawItemIcon(canvas, def, 34);
        btn.appendChild(canvas);
        if (inst.qty > 1) {
          const qty = document.createElement('span');
          qty.className = 'qty';
          qty.textContent = inst.qty;
          btn.appendChild(qty);
        }
        if (def?.slot && EQUIP_SLOTS.includes(def.slot)) {
          const dot = document.createElement('span');
          dot.className = 'rarity';
          dot.style.background = def.slot === 'mano' ? '#e07b5a' : '#8fbf6a';
          btn.appendChild(dot);
        }
        btn.title = def?.name ?? inst.itemId;
        btn.setAttribute('aria-label', def?.name ?? inst.itemId);
      } else {
        btn.setAttribute('aria-label', `Slot ${index + 1} vacio`);
      }
      grid.appendChild(btn);
    });

    this.renderDetail();
  }

  select(uid) {
    this.selectedUid = uid;
    for (const slot of $('inventoryGrid').querySelectorAll('.inv-slot')) {
      slot.classList.toggle('selected', !!uid && slot.dataset.uid === uid);
    }
    this.renderDetail();
  }

  renderDetail() {
    const box = $('itemDetail');
    if (!this.selectedUid) { box.classList.add('hidden'); return; }
    const inst = store.itemByUid(this.selectedUid);
    if (!inst) { box.classList.add('hidden'); return; }
    const def = ITEMS[inst.itemId];
    if (!def) return;
    box.classList.remove('hidden');
    const canvas = $('itemDetailIcon');
    drawItemIcon(canvas, def, 40);
    $('itemDetailName').textContent = def.name;
    const bits = [];
    if (def.levelReq) bits.push(`Lv.${def.levelReq}`);
    if (inst.qty > 1) bits.push(`Cant. ${inst.qty}`);
    $('itemDetailInfo').textContent = `${def.name.toUpperCase()} | ${bits.join(' - ')}`;
    $('itemDetailInfo').textContent = bits.join(' \u00b7 ');

    const stats = [];
    if (def.stats?.atkMin) stats.push(`ATK ${def.stats.atkMin}-${def.stats.atkMax}`);
    if (def.stats?.defense) stats.push(`DEF +${def.stats.defense}`);
    if (def.stats?.maxHp) stats.push(`HP +${def.stats.maxHp}`);
    if (def.stats?.maxMp) stats.push(`MP +${def.stats.maxMp}`);
    if (def.stats?.speed) stats.push(`VEL +${def.stats.speed}`);
    const use = def.use?.healHp ? `Cura ${def.use.healHp} HP` : def.use?.healMp ? `Restaura ${def.use.healMp} MP` : '';
    $('itemDetailDesc').textContent = [stats.join(' \u00b7 '), use, def.description].filter(Boolean).join('\n');

    const canEquip = def.slot === 'mano' || def.slot === 'weapon' || def.type === 'weapon' || def.type === 'tool' || EQUIP_SLOTS.includes(def.slot);
    $('btnEquip').classList.toggle('hidden', !canEquip);
    $('btnUse').classList.toggle('hidden', !def.use);
    $('btnSell').classList.toggle('hidden', !def.sell);
    $('btnDrop').classList.remove('hidden');
  }
}
