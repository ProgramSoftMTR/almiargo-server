import { TILE, TILE_SIZE, tileAt, tileRenderColor } from '@almiargo/shared';
import Phaser from 'phaser';

function tileHash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// Ruido continuo en coordenadas de mundo (suave a traves de varios tiles).
function contNoise(wx, wy) {
  const x = wx * 0.05;
  const y = wy * 0.05;
  const v = Math.sin(x * 1.7 + y * 0.9)
          + 0.6 * Math.sin(x * 0.6 - y * 1.3)
          + 0.35 * Math.sin(x * 2.9 + y * 2.1);
  return (v + 1.95) / 3.9; // ~0..1
}

function drawTile(ctx, scene, world, x, y, px, py) {
  const tile = tileAt(world, x, y);
  const chopped = !!(world?.chopped && world.chopped.has(`${x},${y}`));
  const treeTiles = [TILE.TREE, TILE.TREE_PALM, TILE.TREE_PINE, TILE.TREE_ACACIA, TILE.TREE_DEAD];
  // Bioma base de pradera: se tratan como el mismo suelo para bordes/transiciones.
  const prairieBaseTiles = [TILE.GRASS, TILE.FLOWERS, TILE.DIRT, TILE.TREE, TILE.ROCK, TILE.STONE, TILE.CITY, TILE.PATH, TILE.PLAZA];
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

  const wx0 = x * TILE_SIZE;
  const wy0 = y * TILE_SIZE;
  const base = tileRenderColor(tile ?? TILE.GRASS, x, y) ?? 0x3d6b3a;
  const baseColor = `#${Number(base).toString(16).padStart(6, '0')}`;
  const grassBaseTiles = [TILE.GRASS, TILE.FLOWERS, TILE.DIRT, TILE.FOREST, TILE.TREE, TILE.ROCK, TILE.STONE, TILE.CITY, TILE.PATH, TILE.PLAZA];
  // Seleccion de textura de suelo para la pradera (mezcla deterministica).
  let groundKey = null;
  if (grassBaseTiles.includes(tile)) {
    if (tile === TILE.TREE || tile === TILE.ROCK) {
      groundKey = 'sprite_tile_grass_liso';
    } else {
      const hr = tileHash(x, y);
      if (tile === TILE.GRASS && hr > 0.84) {
        // Debajo de hierba alta / roca procedural: suelo limpio.
        groundKey = 'sprite_tile_grass_liso';
      } else if (tile === TILE.GRASS || tile === TILE.DIRT || tile === TILE.FLOWERS) {
        if (hr < 0.40) groundKey = 'sprite_tile_grass_liso';
        else if (hr < 0.65) groundKey = 'sprite_tile_grass';
        else if (hr < 0.85) groundKey = 'sprite_tile_grass2';
        else if (hr < 0.95) groundKey = 'sprite_tile_grass_rock';
        else groundKey = 'sprite_tile_grass_rockrock';
      } else {
        groundKey = 'sprite_tile_grass';
      }
    }
  }
  const primaryTex = groundKey ? scene?.textures?.get?.(groundKey) : null;
  const fallbackTex = scene?.textures?.get?.('sprite_tile_grass');
  const groundTex = (primaryTex && typeof primaryTex.getSourceImage === 'function') ? primaryTex
    : (fallbackTex && typeof fallbackTex.getSourceImage === 'function') ? fallbackTex : null;
  if (groundTex) {
    try {
      ctx.drawImage(groundTex.getSourceImage(), px, py, TILE_SIZE, TILE_SIZE);
    } catch (e) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
    // Si el tile usa sprite de cesped, no se dibuja ningun adorno procedural posterior.
    return;
  }
  ctx.fillStyle = baseColor;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  if (grassBaseTiles.includes(tile)) return;

  const h = tileHash(x, y);

  // --- Capa de ruido organico continuo para evitar cuadricula marcada ---
  // Parches suaves de sombra/luz posicionados en coords de mundo.
  if (tile === TILE.FOREST ||
      tile === TILE.SAND || tile === TILE.SAVANNA ||
      tile === TILE.SWAMP) {
    for (let i = 0; i < 14; i += 1) {
      const gx = wx0 + ((h * 97 + i * 13) % TILE_SIZE);
      const gy = wy0 + ((h * 53 + i * 19) % TILE_SIZE);
      const n = contNoise(gx, gy);
      const alpha = 0.06 + n * 0.10;
      ctx.fillStyle = n > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      const bw = 2 + (i % 3);
      const bh = 2 + ((i + 1) % 3);
      ctx.fillRect(px + (gx - wx0), py + (gy - wy0), bw, bh);
    }
  }

  // --- Transiciones organicas moteadas entre biomas ---
  const neighbors = [
    { dx: 0, dy: -1, side: 'top' },
    { dx: 0, dy: 1, side: 'bottom' },
    { dx: -1, dy: 0, side: 'left' },
    { dx: 1, dy: 0, side: 'right' },
  ];
  for (const n of neighbors) {
    const nt = tileAt(world, x + n.dx, y + n.dy);
    if (nt === tile) continue;
    // Mismo bioma base de pradera: sin bordes/transiciones entre ellos ni alrededor de arboles.
    if (prairieBaseTiles.includes(tile) && prairieBaseTiles.includes(nt)) continue;
    // color aproximado del vecino
    const nb = tileRenderColor(nt ?? TILE.GRASS, x + n.dx, y + n.dy) ?? 0x3d6b3a;
    const ncolor = `#${Number(nb).toString(16).padStart(6, '0')}`;
    ctx.fillStyle = ncolor;
    // banda dentada: pixeles dispersos que se adelgazan hacia el interior
    if (n.side === 'top' || n.side === 'bottom') {
      const edgeY = n.side === 'top' ? 0 : TILE_SIZE - 1;
      const inward = n.side === 'top' ? 1 : -1;
      for (let ix = 0; ix < TILE_SIZE; ix += 1) {
        const depth = 1 + Math.floor(contNoise(wx0 + ix, wy0 + edgeY) * 4);
        for (let d = 0; d < depth; d += 1) {
          const yy = edgeY + inward * d;
          if (yy < 0 || yy >= TILE_SIZE) continue;
          if (contNoise(wx0 + ix * 3.7, wy0 + yy * 3.7) > 0.42) {
            ctx.fillRect(px + ix, py + yy, 1, 1);
          }
        }
      }
    } else {
      const edgeX = n.side === 'left' ? 0 : TILE_SIZE - 1;
      const inward = n.side === 'left' ? 1 : -1;
      for (let iy = 0; iy < TILE_SIZE; iy += 1) {
        const depth = 1 + Math.floor(contNoise(wx0 + edgeX, wy0 + iy) * 4);
        for (let d = 0; d < depth; d += 1) {
          const xx = edgeX + inward * d;
          if (xx < 0 || xx >= TILE_SIZE) continue;
          if (contNoise(wx0 + xx * 3.7, wy0 + iy * 3.7) > 0.42) {
            ctx.fillRect(px + xx, py + iy, 1, 1);
          }
        }
      }
    }
  }

  // --- Detalles por bioma ---
  if (tile === TILE.GRASS || tile === TILE.FLOWERS) {
    // Prairia base 100% limpia: sin adornos procedurales.
    // (Hierba alta ahora se renderiza como sprite independiente en WorldScene.)
    // (Flores y relieve se dejan a los sprites grass_tall, rock y rockgrass.)
  } else if (tile === TILE.SAND) {
    ctx.fillStyle = 'rgba(255,235,180,.18)';
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
    // borde organico con tierra/arena
    // foam en orillas
    for (const n of neighbors) {
      const nt = tileAt(world, x + n.dx, y + n.dy);
      if (nt === TILE.WATER) continue;
      ctx.fillStyle = 'rgba(220,240,255,.35)';
      if (n.side === 'top') for (let i = 0; i < TILE_SIZE; i += 2) if (contNoise(wx0 + i, wy0) > 0.5) ctx.fillRect(px + i, py, 2, 2);
      if (n.side === 'bottom') for (let i = 0; i < TILE_SIZE; i += 2) if (contNoise(wx0 + i, wy0 + TILE_SIZE) > 0.5) ctx.fillRect(px + i, py + TILE_SIZE - 2, 2, 2);
      if (n.side === 'left') for (let i = 0; i < TILE_SIZE; i += 2) if (contNoise(wx0, wy0 + i) > 0.5) ctx.fillRect(px, py + i, 2, 2);
      if (n.side === 'right') for (let i = 0; i < TILE_SIZE; i += 2) if (contNoise(wx0 + TILE_SIZE, wy0 + i) > 0.5) ctx.fillRect(px + TILE_SIZE - 2, py + i, 2, 2);
    }
  } else if (tile === TILE.WALL) {
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(px, py + TILE_SIZE - 4, TILE_SIZE, 4);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(px, py, TILE_SIZE, 2);
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
    ctx.fillStyle = 'rgba(255,235,180,.18)';
    for (let i = 0; i < 5; i += 1) {
      const bx = px + ((h * 83 + i * 29) % TILE_SIZE);
      const by = py + ((h * 61 + i * 11) % TILE_SIZE);
      ctx.fillRect(bx, by, 2, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 29, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 30, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2418';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const rx = px + 6 + i * 7;
      ctx.beginPath();
      ctx.moveTo(px + 16, py + 22);
      ctx.quadraticCurveTo(rx, py + 28, rx, py + 31);
      ctx.stroke();
    }
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
    // Solo sombra de contacto en el suelo; el arbol se renderiza como sprite independiente.
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 29, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // destellos sutiles muy moderados
  if (!prairieBaseTiles.includes(tile) && contNoise(wx0 + 23, wy0 + 29) > 0.93) {
    ctx.fillStyle = 'rgba(255,255,240,.6)';
    ctx.fillRect(px + 4 + Math.floor(contNoise(wx0, wy0) * 20), py + 4 + Math.floor(contNoise(wx0 + 1, wy0) * 20), 1, 1);
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
          drawTile(ctx, scene, world, gx, gy, lx * TILE_SIZE, ly * TILE_SIZE);
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
      drawTile(ctx, scene, world, gx, gy, lx * TILE_SIZE, ly * TILE_SIZE);
    }
  }
  texture.refresh();
}