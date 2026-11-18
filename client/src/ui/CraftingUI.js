import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';

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
      <div class="sheet-header">
        <h3>Mesa de Trabajo</h3>
        <button id="craftClose" class="sheet-close">✕</button>
      </div>
      <div class="craft-body">
        <div class="craft-top">
          <button id="craftRecipes" class="craft-btn">📖 Recetas</button>
          <div id="craftGrid" class="craft-grid"></div>
          <div class="craft-arrow">→</div>
          <div id="craftOutput" class="craft-output"></div>
        </div>
        <div id="craftRecipesPanel" class="craft-recipes hidden"></div>
        <div class="craft-inv-label">Inventario</div>
        <div id="craftInventory" class="craft-inventory"></div>
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
    // Devuelve items de la grilla al inventario (local, sin pérdida real).
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
      cell.className = 'craft-cell';
      cell.textContent = this.grid[i] ? this.grid[i] : '';
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
    out.textContent = '';
  }

  renderInventory() {
    if (!this.modal || this.modal.classList.contains('hidden')) return;
    const el = this.modal.querySelector('#craftInventory');
    el.innerHTML = '';
    const inv = store.player?.inventory ?? [];
    for (const it of inv) {
      const btn = document.createElement('button');
      btn.className = 'craft-inv-item' + (this.selected === it.itemId ? ' selected' : '');
      btn.textContent = `${it.itemId} x${it.qty}`;
      btn.addEventListener('click', () => {
        this.selected = it.itemId;
        this.renderInventory();
      });
      el.appendChild(btn);
    }
  }

  renderRecipes() {
    const el = this.modal.querySelector('#craftRecipesPanel');
    const recipes = [
      'Cuerda: 3 lianas columna centro + 1 rama arriba-izq',
      'Poción viscosa: 1 liana arriba + 2 slime centro/abajo',
      'Elixir agilidad: 1 rama arriba + 3 slime centro + 1 rama abajo',
      'Arco largo: madera manglar arriba/centro-izq/abajo + cuerda columna derecha',
      'Báculo: diagonal slime arriba-der, rama centro, madera abajo-izq',
      'Escudo: fila superior madera, centro slime, abajo-centro madera',
    ];
    el.innerHTML = recipes.map((r) => `<div class="craft-recipe">${r}</div>`).join('');
  }

  doCraft() {
    socket.send('craft_grid', { grid: this.grid });
  }
}