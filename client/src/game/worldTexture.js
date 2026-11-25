import { TILE, TILE_SIZE, tileAt, tileRenderColor } from '@almiargo/shared';
import Phaser from 'phaser';

function tileHash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function drawTile(ctx, world, x, y, px, py) {
  const tile = tileAt(world, x, y);
  const chopped = !!(world?.chopped && world.chopped.has(`${x},${y}`));
  const treeTiles = [TILE.TREE, TILE.TREE_PALM, TILE.TREE_PINE, TILE.TREE_ACACIA, TILE.TREE_DEAD];
  if (chopped && treeTiles.includes(tile)) {
    const groundColor = tile === TILE.TREE_PALM ? '#c9b27a'
      : tile === TILE.TREE_DEAD ? '#2f4a3a'
      : tile === TILE.TREE_PINE ? '#dfe7f0'
      : tile === TILE.TREE_ACACIA ? '#b9a05a'
      : '#2f5730';
    ctx.fillStyle = groundColor;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    return;
  }
  const base = tileRenderColor(tile ?? TILE.GRASS, x, y) ?? 0x3d6b3a;
  const color = `#${Number(base).toString(16).padStart(6, '0')}`;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  const h = tileHash(x, y);
  if (tile === TILE.GRASS || tile === TILE.FLOWERS) {
    // Base con variacion tonal determinista (varias variantes de pasto).
    // Motitas y briznas pixel art.
    const dark = h > 0.66 ? 'rgba(18,40,18,.30)' : 'rgba(24,52,24,.24)';
    const light = h > 0.33 ? 'rgba(95,140,75,.22)' : 'rgba(110,160,90,.18)';
    ctx.fillStyle = dark;
    for (let i = 0; i < 6; i += 1) {
      const bx = px + ((h * 97 + i * 13) % (TILE_SIZE - 2));
      const by = py + ((h * 53 + i * 19) % (TILE_SIZE - 3));
      ctx.fillRect(bx, by, 2, 2);
    }
    ctx.fillStyle = light;
    for (let i = 0; i < 4; i += 1) {
      const bx = px + ((h * 71 + i * 17) % (TILE_SIZE - 2));
      const by = py + ((h * 43 + i * 23) % (TILE_SIZE - 3));
      ctx.fillRect(bx, by, 1, 3);
    }
    // Briznas de hierba alta (tufts) en algunas casillas, sin bloquear paso.
    if (h > 0.58) {
      const tuftColor = h > 0.78 ? '#4a8a4a' : '#3f7a3f';
      ctx.fillStyle = tuftColor;
      const tx0 = px + 4 + Math.floor(h * 12);
      const ty0 = py + 6 + Math.floor(h * 8);
      ctx.fillRect(tx0, ty0, 2, 6);
      ctx.fillRect(tx0 + 1, ty0 - 2, 1, 3);
      ctx.fillRect(tx0 + 3, ty0 + 1, 2, 5);
      // sombra base del tuft
      ctx.fillStyle = 'rgba(10,25,10,.35)';
      ctx.fillRect(tx0, ty0 + 6, 6, 1);
      // destello sutil
      ctx.fillStyle = 'rgba(180,220,140,.45)';
      ctx.fillRect(tx0 + 1, ty0, 1, 1);
    }
    if (h > 0.82) {
      // segundo tuft mas pequeno
      ctx.fillStyle = '#3a6a3a';
      const tx1 = px + 18 + Math.floor(h * 6);
      const ty1 = py + 14 + Math.floor(h * 5);
      ctx.fillRect(tx1, ty1, 2, 4);
      ctx.fillRect(tx1 + 2, ty1 + 1, 1, 3);
    }
    if (tile === TILE.FLOWERS) {
      ctx.fillStyle = h > 0.5 ? '#e8d26a' : '#d97a9e';
      for (let i = 0; i < 3; i += 1) {
        const bx = px + 5 + ((h * 71 + i * 23) % 22);
        const by = py + 5 + ((h * 41 + i * 17) % 22);
        ctx.fillRect(bx, by, 3, 3);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillRect(bx, by, 1, 1);
        ctx.fillStyle = h > 0.5 ? '#e8d26a' : '#d97a9e';
      }
    }
  } else if (tile === TILE.DIRT || tile === TILE.SAND) {
    const isSand = tile === TILE.SAND;
    ctx.fillStyle = isSand ? 'rgba(255,235,180,.18)' : 'rgba(30,20,10,.25)';
    for (let i = 0; i < 6; i += 1) {
      const bx = px + ((h * 83 + i * 29) % TILE_SIZE);
      const by = py + ((h * 61 + i * 11) % TILE_SIZE);
      ctx.fillRect(bx, by, 2, 2);
    }
    // Parches/pebbles irregulares para tierra.
    if (!isSand) {
      ctx.fillStyle = 'rgba(20,12,6,.30)';
      for (let i = 0; i < 3; i += 1) {
        const bx = px + ((h * 47 + i * 31) % (TILE_SIZE - 4));
        const by = py + ((h * 59 + i * 13) % (TILE_SIZE - 4));
        ctx.fillRect(bx, by, 3, 2);
      }
      // Transicion organica hacia pasto en bordes adyacentes.
      const neighbors = [
        { dx: 0, dy: -1, side: 'top' },
        { dx: 0, dy: 1, side: 'bottom' },
        { dx: -1, dy: 0, side: 'left' },
        { dx: 1, dy: 0, side: 'right' },
      ];
      for (const n of neighbors) {
        const nt = tileAt(world, x + n.dx, y + n.dy);
        if (nt === TILE.GRASS || nt === TILE.FLOWERS) {
          ctx.fillStyle = 'rgba(60,100,50,.35)';
          if (n.side === 'top') for (let i = 0; i < 4; i += 1) ctx.fillRect(px + 2 + i * 7, py, 3, 2);
          if (n.side === 'bottom') for (let i = 0; i < 4; i += 1) ctx.fillRect(px + 2 + i * 7, py + TILE_SIZE - 2, 3, 2);
          if (n.side === 'left') for (let i = 0; i < 4; i += 1) ctx.fillRect(px, py + 2 + i * 7, 2, 3);
          if (n.side === 'right') for (let i = 0; i < 4; i += 1) ctx.fillRect(px + TILE_SIZE - 2, py + 2 + i * 7, 2, 3);
        }
      }
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
    // Arena seca
    ctx.fillStyle = '#c9b27a';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = 'rgba(255,235,180,.18)';
    for (let i = 0; i < 5; i += 1) {
      const bx = px + ((h * 83 + i * 29) % TILE_SIZE);
      const by = py + ((h * 61 + i * 11) % TILE_SIZE);
      ctx.fillRect(bx, by, 2, 2);
    }
    // Sombra suave en arena
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 29, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tronco curvo determinista
    const lean = h > 0.5 ? -3 : 3;
    ctx.strokeStyle = '#8a5a30';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 30);
    ctx.quadraticCurveTo(px + 16 + lean, py + 18, px + 16 + lean * 2, py + 8);
    ctx.stroke();
    ctx.strokeStyle = '#5a3a1e';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const ty = py + 26 - i * 5;
      const tx = px + 16 + Math.round((lean / 3) * (3 - i));
      ctx.beginPath();
      ctx.moveTo(tx - 2, ty);
      ctx.lineTo(tx + 2, ty);
      ctx.stroke();
    }
    // Copa tropical
    ctx.fillStyle = '#2a8a3a';
    for (let i = 0; i < 6; i += 1) {
      const ang = (i / 6) * Math.PI * 2;
      const lx = px + 16 + lean * 2 + Math.cos(ang) * 10;
      const ly = py + 8 + Math.sin(ang) * 6;
      ctx.beginPath();
      ctx.ellipse(lx, ly, 7, 3, ang, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#4aaa4a';
    for (let i = 0; i < 5; i += 1) {
      const ang = (i / 5) * Math.PI * 2 + 0.4;
      const lx = px + 16 + lean * 2 + Math.cos(ang) * 8;
      const ly = py + 8 + Math.sin(ang) * 5;
      ctx.beginPath();
      ctx.ellipse(lx, ly, 5, 2.5, ang, 0, Math.PI * 2);
      ctx.fill();
    }
    // Cocos
    ctx.fillStyle = '#3a2410';
    for (let i = 0; i < 3; i += 1) {
      const cx = px + 14 + lean * 2 + i * 3;
      const cy = py + 9 + (i % 2);
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
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
    // Pantano (pasto verde oscuro)
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
    // Sombra humeda
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 30, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Raices aereas (zancudas)
    ctx.strokeStyle = '#2a2418';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const rx = px + 6 + i * 7;
      ctx.beginPath();
      ctx.moveTo(px + 16, py + 22);
      ctx.quadraticCurveTo(rx, py + 28, rx, py + 31);
      ctx.stroke();
    }
    // Tronco retorcido/bifurcado
    ctx.strokeStyle = '#3a3228';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 30);
    ctx.quadraticCurveTo(px + 12, py + 18, px + 14, py + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 14, py + 16);
    ctx.lineTo(px + 20, py + 10);
    ctx.stroke();
    // Copa ancha irregular achatada en 3 tonos verde musgo/oliva
    const greens = ['#3a4a2a', '#4a5a30', '#5a6a38'];
    ctx.fillStyle = greens[0];
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 7, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = greens[1];
    ctx.beginPath();
    ctx.ellipse(px + 11, py + 6, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px + 21, py + 6, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = greens[2];
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 5, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Musgo colgante
    ctx.fillStyle = 'rgba(60,80,40,.6)';
    for (let i = 0; i < 5; i += 1) {
      const mx = px + 8 + ((h * 67 + i * 17) % 16);
      const my = py + 11 + ((h * 43 + i * 11) % 6);
      ctx.fillRect(mx, my, 1, 3 + (i % 3));
    }
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
    // Sombra suave proyectada en el suelo (volumen).
    const shGrad = ctx.createRadialGradient(px + 16, py + 29, 2, px + 16, py + 29, 14);
    shGrad.addColorStop(0, 'rgba(0,0,0,.45)');
    shGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 29, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tronco con contorno oscuro.
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(px + 12, py + 13, 8, 18);
    ctx.fillStyle = '#3a2817';
    ctx.fillRect(px + 13, py + 14, 6, 16);
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(px + 14, py + 14, 2, 16);
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(px + 19, py + 14, 1, 16);
    // Copa sombreada con luces/sombras y contorno oscuro.
    const canopyDark = h > 0.5 ? '#15331a' : '#122d16';
    const canopyMid = h > 0.5 ? '#1b3f20' : '#16361b';
    const canopyLight = h > 0.5 ? '#234a28' : '#1d4022';
    // contorno
    ctx.fillStyle = '#0e2212';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 9, 16, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = canopyDark;
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 9, 15, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = canopyMid;
    ctx.beginPath();
    ctx.ellipse(px + 11, py + 7, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px + 21, py + 8, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = canopyLight;
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 5, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // luces puntuales
    ctx.fillStyle = 'rgba(90,150,95,.45)';
    ctx.fillRect(px + 6, py + 4, 5, 3);
    ctx.fillRect(px + 20, py + 5, 6, 3);
    ctx.fillRect(px + 13, py + 2, 4, 2);
    // sombra en copa
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(px + 9, py + 14, 14, 3);
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

export function regenerateWorldChunk(scene, world, cx, cy) {
  const chunkSize = 64;
  const key = `world_ground_${cx}_${cy}`;
  const texture = scene.textures.get(key);
  if (!texture || !texture.canvas) return;
  const tilesW = Math.min(chunkSize, world.width - cx * chunkSize);
  const tilesH = Math.min(chunkSize, world.height - cy * chunkSize);
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, texture.width, texture.height);
  ctx.imageSmoothingEnabled = false;
  for (let ly = 0; ly < tilesH; ly += 1) {
    for (let lx = 0; lx < tilesW; lx += 1) {
      const gx = cx * chunkSize + lx;
      const gy = cy * chunkSize + ly;
      drawTile(ctx, world, gx, gy, lx * TILE_SIZE, ly * TILE_SIZE);
    }
  }
  texture.refresh();
}