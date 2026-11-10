import Phaser from 'phaser';
import {
  TILE,
  TILE_SIZE,
  ZONES,
  tileAt,
  tileRenderColor,
} from '@almiargo/shared';

/**
 * Todas las texturas se generan en runtime: el APK no depende de assets
 * externos y el build es más pequeño.
 */

function makeTexture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function drawHumanoid(g, bodyColor, hairColor, weapon, pantsColor, detailColor, skinColor) {
  pantsColor = pantsColor ?? 0x2a2f3a;
  detailColor = detailColor ?? 0x4a3520;
  skinColor = skinColor ?? 0xe0b08a;
  // piernas
  g.fillStyle(pantsColor, 1); g.fillRect(8, 25, 5, 9); g.fillRect(15, 25, 5, 9);
  g.fillStyle(detailColor, 1); g.fillRect(7, 33, 7, 2); g.fillRect(14, 33, 7, 2);
  // torso
  g.fillStyle(bodyColor, 1); g.fillRect(8, 15, 12, 12);
  g.fillStyle(0xffffff, 0.14); g.fillRect(9, 16, 3, 9);
  // cinturon
  g.fillStyle(detailColor, 1); g.fillRect(8, 24, 12, 2);
  // brazos
  g.fillStyle(bodyColor, 1); g.fillRect(5, 16, 4, 9); g.fillRect(19, 16, 4, 9);
  g.fillStyle(skinColor, 1); g.fillRect(5, 24, 4, 3); g.fillRect(19, 24, 4, 3);
  // cabeza
  g.fillStyle(skinColor, 1); g.fillRect(9, 5, 10, 10);
  g.fillStyle(skinColor, 0.7); g.fillRect(9, 12, 10, 3);
  g.fillStyle(hairColor, 1); g.fillRect(8, 3, 12, 5); g.fillRect(8, 6, 2, 4); g.fillRect(18, 6, 2, 4);
  // ojos
  g.fillStyle(0x15181e, 1); g.fillRect(11, 9, 2, 2); g.fillRect(15, 9, 2, 2);

  if (weapon === 'knight') {
    g.fillStyle(0xd8dde6, 1); g.fillRect(24, 8, 2, 20);
    g.fillStyle(0xf2f5f9, 1); g.fillRect(24, 8, 1, 18);
    g.fillStyle(0x8a6034, 1); g.fillRect(22, 26, 6, 2);
    g.fillStyle(0xb8874e, 1); g.fillRect(23, 28, 2, 3);
  } else if (weapon === 'archer') {
    g.lineStyle(2, 0x9b6b3f, 1);
    g.beginPath();
    g.arc(23, 18, 9, -Math.PI / 2, Math.PI / 2, false);
    g.strokePath();
    g.lineStyle(1, 0xe8e8e8, 0.8);
    g.beginPath(); g.moveTo(23, 9); g.lineTo(23, 27); g.strokePath();
  } else if (weapon === 'mage') {
    g.fillStyle(0x8a6034, 1); g.fillRect(24, 4, 2, 26);
    g.fillStyle(0x9b6b3f, 1); g.fillRect(24, 4, 1, 26);
    g.fillStyle(0x8f7bff, 1); g.fillCircle(25, 4, 4);
    g.fillStyle(0xc6baff, 1); g.fillCircle(24, 3, 1.6);
  }
}

export function createEntityTextures(scene) {
  const knightBody = 0xc84b4b;
  const archerBody = 0x3fa86b;
  const mageBody = 0x5b6fd6;

  makeTexture(scene, 'player_knight', 32, 36, (g) => drawHumanoid(g, knightBody, 0x5a3a24, 'none', 0x2a2f3a, 0x4a3520, 0xe0b08a));
  makeTexture(scene, 'player_archer', 32, 36, (g) => drawHumanoid(g, archerBody, 0x6b4a2c, 'none', 0x2a2f3a, 0x4a3520, 0xe0b08a));
  makeTexture(scene, 'player_mage', 32, 36, (g) => drawHumanoid(g, mageBody, 0xd8d0b8, 'none', 0x2a2f3a, 0x4a3520, 0xe0b08a));

  makeTexture(scene, 'monster_slime', 32, 28, (g) => {
    g.fillStyle(0x2e7a50, 1); g.fillEllipse(16, 20, 26, 13);
    g.fillStyle(0x58c98c, 1); g.fillEllipse(16, 17, 24, 16);
    g.fillStyle(0x8ae6b1, 0.65); g.fillEllipse(12, 12, 9, 6);
    g.fillStyle(0x0f2018, 1); g.fillRect(11, 15, 3, 4); g.fillRect(19, 15, 3, 4);
    g.fillStyle(0xffffff, 0.7); g.fillRect(12, 16, 1, 2); g.fillRect(20, 16, 1, 2);
  });

  makeTexture(scene, 'monster_rat', 34, 26, (g) => {
    g.fillStyle(0x6f6253, 1); g.fillEllipse(16, 17, 23, 12);
    g.fillStyle(0x9b8a72, 1); g.fillEllipse(13, 15, 18, 9);
    g.fillStyle(0x7a6a57, 1); g.fillEllipse(25, 12, 10, 9);
    g.fillStyle(0x9b8a72, 1); g.fillEllipse(26, 11, 6, 6);
    g.fillStyle(0xc9a7a0, 1); g.fillEllipse(24, 7, 4, 4);
    g.fillStyle(0x2a2018, 1); g.fillRect(28, 10, 2, 2);
    g.fillStyle(0x6f6253, 1); g.fillRect(2, 18, 10, 2);
    g.fillStyle(0x9b8a72, 1); g.fillRect(6, 22, 3, 3); g.fillRect(20, 22, 3, 3);
  });

  makeTexture(scene, 'monster_orc', 34, 38, (g) => {
    g.fillStyle(0x2c4020, 1); g.fillRect(9, 27, 6, 9); g.fillRect(19, 27, 6, 9);
    g.fillStyle(0x7fae5a, 1); g.fillRect(7, 14, 20, 15);
    g.fillStyle(0x93c46b, 1); g.fillRect(8, 15, 6, 11);
    g.fillStyle(0x587a3c, 1); g.fillRect(7, 27, 20, 3);
    g.fillStyle(0x7fae5a, 1); g.fillRect(2, 16, 6, 12); g.fillRect(26, 16, 6, 12);
    g.fillStyle(0x6d9a4c, 1); g.fillRect(9, 5, 16, 12);
    g.fillStyle(0x587a3c, 1); g.fillRect(8, 3, 18, 5);
    g.fillStyle(0xffe9c9, 1); g.fillRect(12, 13, 2, 4); g.fillRect(20, 13, 2, 4);
    g.fillStyle(0xff4a4a, 1); g.fillRect(11, 9, 3, 2); g.fillRect(20, 9, 3, 2);
    g.fillStyle(0x3a2a1a, 1); g.fillRect(15, 8, 1, 2);
  });

  makeTexture(scene, 'monster_skeleton', 32, 38, (g) => {
    g.fillStyle(0xbfc7d1, 1); g.fillRect(10, 6, 12, 10);
    g.fillStyle(0xd8dde6, 1); g.fillRect(11, 7, 10, 8);
    g.fillStyle(0x2b2f37, 1); g.fillRect(12, 10, 3, 3); g.fillRect(18, 10, 3, 3);
    g.fillRect(15, 13, 2, 2);
    g.fillStyle(0xd8dde6, 1); g.fillRect(14, 16, 4, 10);
    for (let i = 0; i < 3; i += 1) g.fillRect(9, 17 + i * 3, 14, 2);
    g.fillStyle(0xbfc7d1, 1); g.fillRect(5, 17, 4, 11); g.fillRect(23, 17, 4, 11);
    g.fillRect(9, 27, 5, 9); g.fillRect(18, 27, 5, 9);
    g.fillStyle(0xd8dde6, 1); g.fillRect(22, 5, 2, 22);
    g.fillStyle(0x8f99a8, 1); g.fillRect(20, 4, 6, 2);
  });

  makeTexture(scene, 'monster_golem', 42, 42, (g) => {
    g.fillStyle(0x3a3244, 1); g.fillRect(9, 28, 8, 12); g.fillRect(25, 28, 8, 12);
    g.fillStyle(0x6a5e78, 1); g.fillRect(7, 13, 28, 18);
    g.fillStyle(0x7d6f8c, 1); g.fillRect(9, 15, 9, 7); g.fillRect(23, 21, 8, 6);
    g.fillStyle(0x4c4258, 1); g.fillRect(7, 29, 28, 3);
    g.fillStyle(0x6a5e78, 1); g.fillRect(1, 16, 7, 14); g.fillRect(34, 16, 7, 14);
    g.fillStyle(0x554a63, 1); g.fillRect(10, 3, 22, 12);
    g.fillStyle(0xd36bff, 1); g.fillRect(14, 8, 4, 3); g.fillRect(25, 8, 4, 3);
    g.fillStyle(0xf0c6ff, 0.8); g.fillRect(14, 8, 1, 1); g.fillRect(25, 8, 1, 1);
    g.fillStyle(0x2a2432, 1); g.fillRect(17, 24, 9, 2);
  });

  makeTexture(scene, 'npc_merchant', 30, 36, (g) => {
    g.fillStyle(0x3b2a1a, 1); g.fillRect(9, 27, 5, 8); g.fillRect(17, 27, 5, 8);
    g.fillStyle(0x6b4a2c, 1); g.fillRect(6, 14, 18, 14);
    g.fillStyle(0x8a643c, 1); g.fillRect(8, 15, 5, 11);
    g.fillStyle(0xd8a37b, 1); g.fillRect(10, 5, 10, 9);
    g.fillStyle(0xcfc6b4, 1); g.fillRect(9, 13, 12, 3);
    g.fillStyle(0x2f2418, 1); g.fillRect(9, 3, 12, 3); g.fillRect(12, 1, 9, 2);
    g.fillStyle(0x1a1a1a, 1); g.fillRect(12, 8, 2, 2); g.fillRect(17, 8, 2, 2);
    g.fillStyle(0xf2c94c, 1); g.fillRect(22, 18, 5, 5);
  });

  makeTexture(scene, 'bag', 26, 24, (g) => {
    g.fillStyle(0x4a3320, 1); g.fillEllipse(13, 15, 22, 16);
    g.fillStyle(0x7a5630, 1); g.fillEllipse(13, 13, 19, 14);
    g.fillStyle(0xa87b44, 1); g.fillEllipse(11, 10, 7, 5);
    g.fillStyle(0x4a3320, 1); g.fillRect(8, 4, 10, 3);
    g.fillStyle(0xf2c94c, 1); g.fillRect(11, 7, 4, 4);
    g.fillStyle(0xfff0a8, 1); g.fillRect(12, 8, 1, 1);
  });

  makeTexture(scene, 'stall', 48, 48, (g) => {
    g.fillStyle(0x5b3e22, 1); g.fillRect(5, 22, 38, 8);
    g.fillStyle(0x7a5630, 1); g.fillRect(7, 30, 34, 14);
    g.fillStyle(0x1e293b, 1); g.fillRect(9, 20, 1, 22); g.fillRect(38, 20, 1, 22);
    g.fillStyle(0xc84b4b, 1); g.fillRect(4, 8, 40, 12);
    for (let i = 0; i < 5; i += 1) {
      g.fillStyle(i % 2 === 0 ? 0xf2e6c9 : 0xc84b4b, 1);
      g.fillRect(4 + i * 8, 8, 8, 12);
    }
    g.fillStyle(0x3a2817, 1); g.fillRect(3, 6, 42, 3);
    g.fillStyle(0x8a6034, 1); g.fillRect(13, 34, 6, 6); g.fillRect(28, 33, 7, 7);
    g.fillStyle(0xf2c94c, 1); g.fillRect(15, 36, 2, 2); g.fillRect(30, 35, 2, 2);
  });
}

/** Pinta el mapa completo en una sola textura (mucho más rápido que 6400 sprites). */
export function createWorldTexture(scene, world) {
  const key = 'world_ground';
  if (scene.textures.exists(key)) return scene.textures.get(key);
  const width = world.width;
  const height = world.height;
  const texture = scene.textures.createCanvas(key, width * TILE_SIZE, height * TILE_SIZE);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tileAt(world, x, y);
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const base = tileRenderColor(tile, x, y);
      const color = `#${base.toString(16).padStart(6, '0')}`;
      ctx.fillStyle = color;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      const h = hash(x, y);
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
        ctx.fillRect(px, py + 26, TILE_SIZE, 6);
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
      } else if (tile === TILE.TREE) {
        // base de hierba
        ctx.fillStyle = '#2f5730';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath();
        ctx.ellipse(px + 16, py + 27, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a3220';
        ctx.fillRect(px + 14, py + 18, 5, 10);
        const green = h > 0.5 ? '#2a5731' : '#1f4728';
        ctx.fillStyle = green;
        ctx.beginPath();
        ctx.ellipse(px + 16, py + 13, 14, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = h > 0.5 ? '#356b3a' : '#2b5c31';
        ctx.beginPath();
        ctx.ellipse(px + 12, py + 10, 8, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(160,210,120,.12)';
        ctx.fillRect(px + 8, py + 5, 7, 4);
      }
    }
  }

  // Bordes de zonas
  const drawZone = (zone, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(
      zone.x1 * TILE_SIZE + 2, zone.y1 * TILE_SIZE + 2,
      (zone.x2 - zone.x1 + 1) * TILE_SIZE - 4,
      (zone.y2 - zone.y1 + 1) * TILE_SIZE - 4,
    );
  };
  drawZone(ZONES.safe, 'rgba(242,201,76,.28)');
  drawZone(ZONES.pvp, 'rgba(224,74,74,.32)');

  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return texture;
}

export function addZoneLabels(scene, world) {
  const style = {
    fontFamily: 'Trebuchet MS, sans-serif',
    align: 'center',
    color: '#ffffff',
  };
  const safe = scene.add.text(
    ((ZONES.safe.x1 + ZONES.safe.x2) / 2) * TILE_SIZE,
    (ZONES.safe.y1 + 3) * TILE_SIZE,
    'CIUDAD SEGURA',
    { ...style, fontSize: '22px', letterSpacing: 6 },
  ).setOrigin(0.5).setAlpha(0.20).setDepth(-70);

  const pvp = scene.add.text(
    ((ZONES.pvp.x1 + ZONES.pvp.x2) / 2) * TILE_SIZE,
    (ZONES.pvp.y1 + 3) * TILE_SIZE,
    'ARENA PvP',
    { ...style, fontSize: '20px', letterSpacing: 5, color: '#ffb0b0' },
  ).setOrigin(0.5).setAlpha(0.38).setDepth(-70);
  return [safe, pvp];
}


function hexToNum(h) {
  return parseInt(String(h ?? '').replace('#', ''), 16) || 0xffffff;
}

export function ensurePlayerTexture(scene, classId, outfit) {
  const cls = classId || 'knight';
  const o = outfit || {};
  for (const k of ['color1','color2','color3','color4','color5']) if (String(o[k] ?? '').toUpperCase() === '#000000') o[k] = '#010101';
  const c1 = hexToNum(o.color1 ?? '#c84b4b');
  const c2 = hexToNum(o.color2 ?? '#2a2f3a');
  const c3 = hexToNum(o.color3 ?? '#5a3a24');
  const c4 = hexToNum(o.color4 ?? '#4a3520');
  const c5 = hexToNum(o.color5 ?? '#e0b08a');
  const key = 'player_' + cls + '_' + c1.toString(16) + '_' + c2.toString(16) + '_' + c3.toString(16) + '_' + c4.toString(16) + '_' + c5.toString(16);
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  drawHumanoid(g, c1, c3, 'none', c2, c4, c5);
  g.generateTexture(key, 32, 36);
  g.destroy();
  return key;
}


export function createResourceTextures(scene) {
  makeTexture(scene, 'tree_stump', 32, 32, (g) => {
    // base de hierba
    g.fillStyle(0x2f5730, 1); g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x254526, 1); g.fillRect(2, 2, 28, 28);
    // tronco cortado
    g.fillStyle(0x5a3a24, 1); g.fillRect(10, 18, 12, 8);
    g.fillStyle(0x7a5630, 1); g.fillRect(11, 19, 10, 6);
    // anillos
    g.fillStyle(0x3a2414, 1); g.fillRect(13, 20, 6, 4);
    g.fillStyle(0x8a6034, 1); g.fillRect(14, 21, 4, 2);
    // astillas
    g.fillStyle(0x4a3320, 1); g.fillRect(6, 24, 4, 3); g.fillRect(22, 22, 4, 3);
  });
}


export function createToolTextures(scene) {
  makeTexture(scene, 'tool_axe', 16, 24, (g) => {
    g.fillStyle(0x8a6034, 1); g.fillRect(7, 2, 2, 20);
    g.fillStyle(0xb8874e, 1); g.fillRect(7, 2, 1, 20);
    g.fillStyle(0xc9c3a4, 1); g.fillRect(3, 0, 10, 6);
    g.fillStyle(0xd8dde6, 1); g.fillRect(4, 1, 8, 4);
    g.fillStyle(0x8f99a8, 1); g.fillRect(5, 2, 6, 2);
  });
}


export function createWeaponTextures(scene) {
  const drawSword = (g) => {
    g.fillStyle(0xd8dde6, 1); g.fillRect(24, 8, 2, 20);
    g.fillStyle(0xf2f5f9, 1); g.fillRect(24, 8, 1, 18);
    g.fillStyle(0x8a6034, 1); g.fillRect(22, 26, 6, 2);
    g.fillStyle(0xb8874e, 1); g.fillRect(23, 28, 2, 3);
  };
  const drawBow = (g) => {
    g.lineStyle(2, 0x9b6b3f, 1);
    g.beginPath();
    g.arc(23, 18, 9, -Math.PI / 2, Math.PI / 2, false);
    g.strokePath();
    g.lineStyle(1, 0xe8e8e8, 0.8);
    g.beginPath(); g.moveTo(23, 9); g.lineTo(23, 27); g.strokePath();
  };
  const drawStaff = (g) => {
    g.fillStyle(0x8a6034, 1); g.fillRect(24, 4, 2, 26);
    g.fillStyle(0x9b6b3f, 1); g.fillRect(24, 4, 1, 26);
    g.fillStyle(0x8f7bff, 1); g.fillCircle(25, 4, 4);
    g.fillStyle(0xc6baff, 1); g.fillCircle(24, 3, 1.6);
  };
  makeTexture(scene, 'weapon_knight', 32, 36, drawSword);
  makeTexture(scene, 'weapon_archer', 32, 36, drawBow);
  makeTexture(scene, 'weapon_mage', 32, 36, drawStaff);
  makeTexture(scene, 'weapon_adventurer', 32, 36, () => {});
}
