import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { drawItemIcon } from './icons.js';
import { ITEMS } from '@almiargo/shared';

const $ = (id) => document.getElementById(id);

const RECIPES = [
  { result: 'braided_rope', grid: ['branches', 'vines', null, null, 'vines', null, null, 'vines', null] },
  { result: 'slime_heal_potion', grid: [null, 'vines', null, null, 'slime_ball', null, null, 'slime_ball', null] },
  // 3x1 vertical en columna central
  // (redefinido abajo)
  { result: 'swamp_agility_elixir', grid: [null, 'branches', null, 'slime_ball', 'slime_ball', 'slime_ball', null, 'branches', null] },
  { result: 'mangrove_longbow', grid: [null, 'mangrove_wood', 'braided_rope', 'mangrove_wood', null, 'braided_rope', null, 'mangrove_wood', 'braided_rope'] },
  { result: 'swamp_staff', grid: [null, null, 'slime_ball', null, 'branches', null, 'mangrove_wood', null, null] },
  { result: 'mangrove_shield', grid: ['mangrove_wood', 'mangrove_wood', 'mangrove_wood', 'mangrove_wood', 'slime_ball', 'mangrove_wood', null, 'mangrove_wood', null] },
  { result: 'mangrove_backpack', grid: ['mangrove_wood', 'vines', 'mangrove_wood', 'mangrove_wood', 'braided_rope', 'mangrove_wood', null, 'vines', null] },
];
// Ajuste: poción viscosa es vertical 3x1
RECIPES[1].grid = [null, 'vines', null, null, 'slime_ball', null, null, 'slime_ball', null];

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
        uiBus.emit('toast', { text: `Fabricado: ${ITEMS[msg.itemId]?.name ?? msg.itemId}`, type: 'success' });
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
      <div style="background:#C6C6C6;border:4px solid #000;box-shadow:inset 2px 2px 0 #FFFFFF,inset -2px -2px 0 #555555;padding:12px;max-width:460px;margin:auto;position:relative;">
        <button id="craftClose" style="position:absolute;top:4px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <button id="craftRecipes" style="width:42px;height:42px;background:#7CBD6B;border:2px solid #000;font-size:22px;cursor:pointer;">📖</button>
          <div id="craftSelectedName" style="flex:1;font-size:12px;font-weight:bold;padding:4px;background:#fff;border:2px inset #373737;">Ningún ítem seleccionado</div>
        </div>
        <div id="craftRecipesPanel" class="hidden" style="margin-bottom:8px;max-height:260px;overflow:auto;"></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <div id="craftGrid" style="display:grid;grid-template-columns:repeat(3,42px);gap:4px;"></div>
          <div style="font-size:24px;margin:0 6px;">➔</div>
          <div id="craftOutput" style="width:52px;height:52px;background:#8B8B8B;border:2px inset #373737;display:flex;align-items:center;justify-content:center;cursor:pointer;"></div>
        </div>
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
    this.updateSelectedName();
    this.modal.classList.remove('hidden');
    this.renderGrid();
    this.renderInventory();
  }

  close() {
    // devolver materiales (solo limpiar grilla)
    this.grid = Array(9).fill(null);
    this.modal.classList.add('hidden');
    this.renderGrid();
  }

  toggleRecipes() {
    const p = this.modal.querySelector('#craftRecipesPanel');
    p.classList.toggle('hidden');
  }

  updateSelectedName() {
    const el = this.modal.querySelector('#craftSelectedName');
    if (!el) return;
    if (this.selected) {
      el.textContent = ITEMS[this.selected]?.name ?? this.selected;
    } else {
      el.textContent = 'Ningún ítem seleccionado';
    }
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
        if (def) try { drawItemIcon(canvas, def, 32); } catch (e) {}
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
    const resultId = this.matchRecipeClient(this.grid);
    if (resultId) {
      const def = ITEMS[resultId];
      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 40;
      if (def) try { drawItemIcon(canvas, def, 40); } catch (e) {}
      out.appendChild(canvas);
    }
  }

  matchRecipeClient(grid) {
    // delegamos al servidor; aquí solo para preview simple: no calcular
    return null;
  }

  renderInventory() {
    if (!this.modal || this.modal.classList.contains('hidden')) return;
    const el = this.modal.querySelector('#craftInventory');
    el.innerHTML = '';
    const inv = store.player?.inventory ?? [];
    for (const it of inv) {
      if (!it) continue;
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
        this.updateSelectedName();
        this.renderInventory();
      });
      if (this.selected === it.itemId) btn.style.outline = '2px solid #FFFF00';
      el.appendChild(btn);
    }
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
  }

  renderRecipes() {
    const el = this.modal.querySelector('#craftRecipesPanel');
    if (!el) return;
    el.innerHTML = '';
    for (const rec of RECIPES) {
      const def = ITEMS[rec.result];
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px;border:1px solid #000;margin-bottom:4px;background:#ddd;cursor:pointer;';
      // resultado
      const resWrap = document.createElement('div');
      resWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:56px;';
      const resCanvas = document.createElement('canvas');
      resCanvas.width = 32; resCanvas.height = 32;
      if (def) try { drawItemIcon(resCanvas, def, 32); } catch (e) {}
      resWrap.appendChild(resCanvas);
      const resName = document.createElement('div');
      resName.style.cssText = 'font-size:9px;text-align:center;';
      resName.textContent = def?.name ?? rec.result;
      resWrap.appendChild(resName);
      card.appendChild(resWrap);

      // mini grid 3x3
      const gridWrap = document.createElement('div');
      gridWrap.style.cssText = 'display:grid;grid-template-columns:repeat(3,24px);gap:2px;';
      for (let i = 0; i < 9; i += 1) {
        const cell = document.createElement('div');
        cell.style.cssText = 'width:24px;height:24px;background:#8B8B8B;border:1px inset #373737;display:flex;align-items:center;justify-content:center;';
        const id = rec.grid[i];
        if (id) {
          const d = ITEMS[id];
          const c = document.createElement('canvas');
          c.width = 20; c.height = 20;
          if (d) try { drawItemIcon(c, d, 20); } catch (e) {}
          cell.appendChild(c);
        }
        gridWrap.appendChild(cell);
      }
      card.appendChild(gridWrap);

      // ingredientes counts
      const counts = {};
      for (const id of rec.grid) {
        if (!id) continue;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      const info = document.createElement('div');
      info.style.cssText = 'font-size:9px;line-height:1.2;';
      const inv = store.player?.inventory ?? [];
      for (const [id, req] of Object.entries(counts)) {
        const have = inv.filter((it) => it?.itemId === id).reduce((a, b) => a + (b.qty ?? 0), 0);
        const line = document.createElement('div');
        line.textContent = `${ITEMS[id]?.name ?? id}: ${have}/${req}`;
        line.style.color = have >= req ? '#1e6b3a' : '#a00';
        info.appendChild(line);
      }
      card.appendChild(info);

      card.addEventListener('click', () => this.autoFill(rec));
      el.appendChild(card);
    }
  }

  autoFill(rec) {
    // devolver materiales actuales (limpiar grilla)
    this.grid = Array(9).fill(null);
    const inv = store.player?.inventory ?? [];
    // contar disponibles
    const available = {};
    for (const it of inv) {
      if (!it) continue;
      available[it.itemId] = (available[it.itemId] ?? 0) + (it.qty ?? 0);
    }
    const used = {};
    for (let i = 0; i < 9; i += 1) {
      const id = rec.grid[i];
      if (!id) continue;
      used[id] = (used[id] ?? 0) + 1;
      if ((available[id] ?? 0) >= (used[id] ?? 0)) {
        this.grid[i] = id;
      } else {
        this.grid[i] = null;
      }
    }
    this.renderGrid();
  }

  doCraft() {
    socket.send('craft_grid', { grid: this.grid });
  }
}