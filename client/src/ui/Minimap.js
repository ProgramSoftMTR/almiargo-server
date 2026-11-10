import { TILE, TILE_SIZE, generateWorld, tileAt, tileRenderColor } from '@almiargo/shared';
import { store } from '../core/store.js';

/** Minimapa 2D con base pre-renderizada y puntos de entidades. */
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = null;
    this.world = null;
  }

  build(world) {
    this.world = world;
    // El servidor sólo envía la semilla: el mapa se regenera igual que en el mundo.
    const map = generateWorld(world.seed);
    const c = document.createElement('canvas');
    c.width = map.width;
    c.height = map.height;
    const ctx = c.getContext('2d');
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tile = tileAt(map, x, y);
        const color = tileRenderColor(tile, x, y);
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        if (tile === TILE.TREE || tile === TILE.WALL) ctx.fillStyle = '#1a2b1c';
        else if (tile === TILE.WATER) ctx.fillStyle = '#234b70';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    this.base = c;
  }

  render() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);
    if (!this.base || !store.player) return;
    ctx.drawImage(this.base, 0, 0, w, h);

    const sx = w / this.world.width;
    const sy = h / this.world.height;
    const dot = (x, y, color, size = 2) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * sx - size / 2, y * sy - size / 2, size, size);
    };

    for (const e of store.entities.values()) {
      if (e.kind === 1) dot(e.x, e.y, '#e05a5a', 2.3);
      else if (e.kind === 0) dot(e.x, e.y, e.skull === 'red' ? '#ff5a5a' : '#8fd1ff', 2.6);
    }
    if (store.npcs) for (const npc of store.npcs.values()) dot(npc.x, npc.y, '#f2c94c', 2.2);
    for (const bag of store.bags.values()) dot(bag.x, bag.y, '#ffe08a', 2);
    for (const stall of store.stalls.values()) dot(stall.x, stall.y, '#6fe0c8', 2.6);

    const p = store.player;
    const px = p.x * sx;
    const py = p.y * sy;
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 1.6, py - 1.6, 3.2, 3.2);
    ctx.fillStyle = p.classId === 'archer' ? '#6fe08a' : p.classId === 'mage' ? '#8f9cff' : '#ff8a8a';
    ctx.fillRect(px - 1, py - 1, 2, 2);
  }
}
