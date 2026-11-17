import { TILE, TILE_SIZE, tileAt, tileRenderColor } from '@almiargo/shared';
import Phaser from 'phaser';

function tileHash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function drawTile(ctx, world, x, y, px, py) {
  const tile = tileAt(world, x, y);
  const base = tileRenderColor(tile ?? TILE.GRASS, x, y) ?? 0x3d6b3a;
  const color = `#${Number(base).toString(16).padStart(6, '0')}`;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  const h = tileHash(x, y);
  if (tile === TILE.GRASS || tile === TILE.FLOWERS) {
    ctx.fillStyle = h > 0.5 ? 'rgba(20,45,20,.28)' : 'rgba(90,130,70,.22)';
    for (let i = 0; i < 4; i += 1) {
      const bx = px + ((h * 97 + i * 13) % TILE_SIZE);
      const by = py + ((h * 53 + i * 19) % TILE_SIZE);
      ctx.fillRect(bx, by, 2, 3);
    }
    if (tile === TILE.FLOWERS) {
      ctx.fillStyle = h > 0.5 ? '#e8d26a' : '#d97a9e';
      for (let i = 0; i < 3; i += 1) {
        const bx = px + 5 + ((h * 71 + i * 23) % 22);
        const by = py + 5 + ((h * 41 + i * 17) % 22);
        ctx.fillRect(bx, by, 3, 3);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillRect(bx, by, 1, 1);
      }
    }
  } else if (tile === TILE.DIRT || tile === TILE.SAND) {
    ctx.fillStyle = tile === TILE.SAND ? 'rgba(255,235,180,.18)' : 'rgba(30,20,10,.25)';
    for (let i = 0; i < 5; i += 1) {
      const bx = px + ((h * 83 + i * 29) % TILE_SIZE);
      const by = py + ((h * 61 + i * 11) % TILE_SIZE);
      ctx.fillRect(bx, by, 2, 2);
    }
  } else if (tile === TILE.STONE) {
    ctx.strokeStyle = 'rgba(20,20,20,.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    if (h > 0.7) {
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fillRect(px + 4, py + 4, 9, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    ctx.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
  } else if (tile === TILE.WATER) {
    ctx.fillStyle = 'rgba(120,180,240,.13)';
    const wy = py + 8 + Math.round(h * 14);
    ctx.fillRect(px + 2, wy, 16, 2);
    ctx.fillRect(px + 18, wy + 9, 10, 2);
    ctx.fillStyle = 'rgba(10,30,50,.2)';
    ctx.fillRect(px, py + TILE_SIZE - 6, TILE_SIZE, 6);
  } else if (tile === TILE.WALL) {
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(px, py + TILE_SIZE - 4, TILE_SIZE, 4);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(px, py, TILE_SIZE, 2);
    ctx.strokeStyle = 'rgba(20,18,16,.4)';
    ctx.lineWidth = 1;
    const off = Math.round(h * 8);
    ctx.strokeRect(px + 2.5, py + 2.5 + off, 13, 9);
    ctx.strokeRect(px + 17.5, py + 2.5 + off, 12, 9);
  } else if (tile === TILE.SWAMP) {
    ctx.fillStyle = '#2f4a3a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(20,40,30,.35)';
    for (let i = 0; i < 6; i += 1) {
      const bx = px + ((h * 71 + i * 19) % (TILE_SIZE - 4));
      const by = py + ((h * 53 + i * 23) % (TILE_SIZE - 4));
      ctx.fillRect(bx, by, 3, 2);
    }
    ctx.fillStyle = 'rgba(80,120,90,.18)';
    ctx.fillRect(px, py + TILE_SIZE - 6, TILE_SIZE, 6);
  } else if (tile === TILE.MOUNTAIN) {
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(px, py + TILE_SIZE - 8, TILE_SIZE, 8);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(px + 4, py + 3, 10, 3);
    ctx.fillRect(px + 16, py + 6, 8, 2);
  } else if (tile === TILE.SNOW) {
    ctx.fillStyle = '#dfe7f0';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(200,215,235,.6)';
    ctx.fillRect(px + 2, py + 4, 12, 2);
    ctx.fillRect(px + 18, py + 14, 10, 2);
    ctx.fillStyle = 'rgba(120,140,170,.15)';
    ctx.fillRect(px, py + TILE_SIZE - 3, TILE_SIZE, 3);
  } else if (tile === TILE.FOREST) {
    ctx.fillStyle = '#2a4a2a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(10,25,10,.3)';
    ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    ctx.fillStyle = 'rgba(60,90,50,.25)';
    for (let i = 0; i < 3; i += 1) {
      const bx = px + 4 + ((h * 61 + i * 17) % 20);
      const by = py + 4 + ((h * 43 + i * 13) % 20);
      ctx.fillRect(bx, by, 4, 3);
    }
  } else if (tile === TILE.TREE_PALM) {
    ctx.fillStyle = '#c9b27a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(px + 14, py + 10, 4, 16);
    ctx.fillStyle = '#2a6a3a';
    ctx.beginPath();
    ctx.arc(px + 16, py + 8, 12, 0, Math.PI * 2);
    ctx.fill();
  } else if (tile === TILE.TREE_PINE) {
    ctx.fillStyle = '#dfe7f0';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = '#2a4020';
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 2);
    ctx.lineTo(px + 28, py + 28);
    ctx.lineTo(px + 4, py + 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(px + 14, py + 24, 4, 8);
  } else if (tile === TILE.TREE_ACACIA) {
    ctx.fillStyle = '#b9a05a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = '#5a4020';
    ctx.fillRect(px + 14, py + 12, 4, 14);
    ctx.fillStyle = '#3a6a2a';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 10, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (tile === TILE.TREE_DEAD) {
    ctx.fillStyle = '#2f4a3a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = '#3a322a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 28);
    ctx.lineTo(px + 16, py + 8);
    ctx.lineTo(px + 10, py + 4);
    ctx.moveTo(px + 16, py + 14);
    ctx.lineTo(px + 22, py + 10);
    ctx.stroke();
  } else if (tile === TILE.SAVANNA) {
    ctx.fillStyle = '#b9a05a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(120,100,40,.25)';
    for (let i = 0; i < 5; i += 1) {
      const bx = px + ((h * 73 + i * 17) % TILE_SIZE);
      const by = py + ((h * 41 + i * 23) % TILE_SIZE);
      ctx.fillRect(bx, by, 3, 2);
    }
  } else if (tile === TILE.TREE) {
    ctx.fillStyle = '#2f5730';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 29, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2817';
    ctx.fillRect(px + 13, py + 14, 6, 16);
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(px + 14, py + 14, 2, 16);
    const green = h > 0.5 ? '#1b3f20' : '#16361b';
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 9, 15, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = h > 0.5 ? '#234a28' : '#1d4022';
    ctx.beginPath();
    ctx.ellipse(px + 11, py + 7, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px + 21, py + 8, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,80,45,.35)';
    ctx.fillRect(px + 6, py + 4, 5, 3);
    ctx.fillRect(px + 20, py + 5, 6, 3);
  }
}

export function createWorldTexture(scene, world) {
  const chunkSize = 64;
  const chunksX = Math.ceil(world.width / chunkSize);
  const chunksY = Math.ceil(world.height / chunkSize);
  const images = [];
  for (let cy = 0; cy < chunksY; cy += 1) {
    for (let cx = 0; cx < chunksX; cx += 1) {
      const key = `world_ground_${cx}_${cy}`;
      let img;
      if (scene.textures.exists(key)) {
        img = scene.add.image(cx * chunkSize * TILE_SIZE, cy * chunkSize * TILE_SIZE, key).setOrigin(0, 0).setDepth(-100);
        images.push(img);
        continue;
      }
      const tilesW = Math.min(chunkSize, world.width - cx * chunkSize);
      const tilesH = Math.min(chunkSize, world.height - cy * chunkSize);
      const texture = scene.textures.createCanvas(key, tilesW * TILE_SIZE, tilesH * TILE_SIZE);
      const ctx = texture.getContext();
      ctx.imageSmoothingEnabled = false;
      for (let ly = 0; ly < tilesH; ly += 1) {
        for (let lx = 0; lx < tilesW; lx += 1) {
          const gx = cx * chunkSize + lx;
          const gy = cy * chunkSize + ly;
          drawTile(ctx, world, gx, gy, lx * TILE_SIZE, ly * TILE_SIZE);
        }
      }
      texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      img = scene.add.image(cx * chunkSize * TILE_SIZE, cy * chunkSize * TILE_SIZE, key).setOrigin(0, 0).setDepth(-100);
      images.push(img);
    }
  }
  return images;
}