import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { drawItemIcon } from './icons.js';
import { ITEMS } from '@almiargo/shared';

const $ = (id) => document.getElementById(id);

export class CraftingUI {
  constructor() {
    this.grid = Array(9).fill(null);
    this.selected = null;
    this.modal = null;
    this.build();
    store.on('snapshot', () => this.renderInventory());
    store.on('profile', () => this.renderInventory());
    store.on('game-event', (msg) => {
      if (msg?.event === 'craft_result') {
        uiBus.emit('toast', { text: `Fabricado: ${msg.itemId}`, type: 'success' });
        this.grid = Array(9).fill(null);
        this.renderGrid();
        this.renderInventory();
      }
    });
  }

  build() {
    const modal = document.createElement('div');
    modal.id = 'craftingModal';
    modal.className = 'sheet hidden';
    modal.innerHTML = `
      <div style="background:#C6C6C6;border:4px solid #000;box-shadow:inset 2px 2px 0 #FFFFFF,inset -2px -2px 0 #555555;padding:12px;max-width:420px;margin:auto;position:relative;">
        <button id="craftClose" style="position:absolute;top:4px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <button id="craftRecipes" style="width:42px;height:42px;background:#7CBD6B;border:2px solid #000;font-size:22px;cursor:pointer;">📖</button>
          <div id="craftGrid" style="display:grid;grid-template-columns:repeat(3,42px);gap:4px;"></div>
          <div style="font-size:24px;margin:0 6px;">➔</div>
          <div id="craftOutput" style="width:52px;height:52px;background:#8B8B8B;border:2px inset #373737;display:flex;align-items:center;justify-content:center;cursor:pointer;"></div>
        </div>
        <div id="craftRecipesPanel" class="hidden" style="font-size:11px;margin-bottom:8px;"></div>
        <div style="font-size:10px;margin-bottom:4px;">Inventario <span id="craftCapacity"></span></div>
        <div id="craftInventory" style="display:grid;grid-template-columns:repeat(9,38px);gap:4px;"></div>
      </div>
    `;
    document.body.appendChild(modal);
    this.modal = modal;
    modal.querySelector('#craftClose').addEventListener('click', () => this.close());
    modal.querySelector('#craftRecipes').addEventListener('click', () => this.toggleRecipes());
    modal.querySelector('#craftOutput').addEventListener('click', () => this.doCraft());
    this.renderGrid();
    this.renderInventory();
    this.renderRecipes();
  }

  open() {
    const hasTable = store.player?.equipment?.tool?.itemId === 'crafting_table';
    if (!hasTable) {
      uiBus.emit('toast', { text: 'Equipa una Mesa de Trabajo', type: 'error' });
      return;
    }
    this.grid = Array(9).fill(null);
    this.selected = null;
    this.modal.classList.remove('hidden');
    this.renderGrid();
    this.renderInventory();
  }

  close() {
    this.grid = Array(9).fill(null);
    this.modal.classList.add('hidden');
    this.renderGrid();
  }

  toggleRecipes() {
    const p = this.modal.querySelector('#craftRecipesPanel');
    p.classList.toggle('hidden');
  }

  renderGrid() {
    const el = this.modal.querySelector('#craftGrid');
    el.innerHTML = '';
    for (let i = 0; i < 9; i += 1) {
      const cell = document.createElement('div');
      cell.style.cssText = 'width:42px;height:42px;background:#8B8B8B;border:2px inset #373737;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;';
      const val = this.grid[i];
      if (val) {
        const def = ITEMS[val];
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        if (def) {
          // drawItemIcon expects canvas and def
          try { drawItemIcon(canvas, def, 32); } catch (e) {}
        }
        cell.appendChild(canvas);
        const qty = document.createElement('span');
        qty.style.cssText = 'position:absolute;bottom:2px;right:4px;font-size:10px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;';
        qty.textContent = '1';
        cell.appendChild(qty);
      }
      cell.addEventListener('click', () => {
        if (this.grid[i]) {
          this.grid[i] = null;
        } else if (this.selected) {
          this.grid[i] = this.selected;
        }
        this.renderGrid();
      });
      el.appendChild(cell);
    }
    const out = this.modal.querySelector('#craftOutput');
    out.innerHTML = '';
  }

  renderInventory() {
    if (!this.modal || this.modal.classList.contains('hidden')) return;
    const el = this.modal.querySelector('#craftInventory');
    el.innerHTML = '';
    const cap = this.modal.querySelector('#craftCapacity');
    if (cap) {
      const p = store.player;
      const used = (p?.inventory ?? []).filter((s) => s !== null).length;
      const bp = p?.equipment?.backpack;
      const bpDef = bp ? ITEMS[bp.itemId] : null;
      const max = bpDef?.slots ?? 8;
      cap.textContent = `(${used} / ${max})`;
      cap.style.color = used >= max ? '#c0392b' : '';
    }
    const inv = store.player?.inventory ?? [];
    for (const it of inv) {
      const def = ITEMS[it.itemId];
      const btn = document.createElement('button');
      btn.style.cssText = 'width:38px;height:38px;background:#C6C6C6;border:2px outset #fff;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer;padding:0;';
      const canvas = document.createElement('canvas');
      canvas.width = 28; canvas.height = 28;
      if (def) try { drawItemIcon(canvas, def, 28); } catch (e) {}
      btn.appendChild(canvas);
      if (it.qty > 1) {
        const qty = document.createElement('span');
        qty.style.cssText = 'position:absolute;bottom:1px;right:3px;font-size:9px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;';
        qty.textContent = it.qty;
        btn.appendChild(qty);
      }
      btn.addEventListener('click', () => {
        this.selected = it.itemId;
        this.renderInventory();
      });
      if (this.selected === it.itemId) btn.style.outline = '2px solid #FFFF00';
      el.appendChild(btn);
    }
  }

  renderRecipes() {
    const el = this.modal.querySelector('#craftRecipesPanel');
    const recipes = [
      'Cuerda: 3 lianas columna centro + 1 rama arriba-izq',
      'Poción viscosa: 1 liana arriba + 2 slime centro/abajo',
    ];
    el.innerHTML = recipes.map((r) => `<div>${r}</div>`).join('');
  }

  doCraft() {
    socket.send('craft_grid', { grid: this.grid });
  }

}
