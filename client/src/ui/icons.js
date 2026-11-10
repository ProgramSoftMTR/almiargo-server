/** Iconos pixel-art generados en canvas (sin assets externos). */

const hex = (n) => `#${Number(n ?? 0x999999).toString(16).padStart(6, '0')}`;
const shade = (n, amount) => {
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
};

export function drawItemIcon(canvas, def, size = 32) {
  if (!canvas || !def) return;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const s = size / 32;
  const color = def.icon?.color ?? 0xaaaaaa;
  const shape = def.icon?.shape ?? 'misc';
  ctx.save();
  ctx.scale(s, s);

  const px = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  if (shape === 'sword') {
    px(7, 25, 8, 3, shade(color, -70));          // guarda
    px(11, 22, 3, 7, shade(color, -50));         // mango
    px(16, 4, 4, 19, hex(color));                // hoja
    px(18, 3, 5, 3, hex(color));                 // punta
    px(17, 4, 2, 18, shade(color, 35));          // brillo
    px(15, 22, 6, 2, shade(color, -30));
  } else if (shape === 'bow') {
    ctx.strokeStyle = hex(color);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(12, 16, 11, -Math.PI / 2.1, Math.PI / 2.1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,240,240,.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16.5, 5.5);
    ctx.lineTo(16.5, 26.5);
    ctx.stroke();
    px(15, 15, 12, 2, '#ddd');
  } else if (shape === 'staff') {
    px(8, 8, 3, 22, '#8a6034');
    px(9, 8, 1, 22, '#b8874e');
    ctx.fillStyle = hex(color);
    ctx.beginPath();
    ctx.arc(22, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.beginPath();
    ctx.arc(20.5, 6.5, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'potion') {
    px(12, 5, 8, 5, '#c9c3a4');                 // corcho
    px(11, 10, 10, 4, '#a9d4e8');               // cuello
    px(8, 14, 16, 14, hex(color));              // cuerpo
    px(8, 14, 16, 4, shade(color, 35));
    px(11, 18, 4, 7, 'rgba(255,255,255,.28)');
    px(9, 24, 14, 2, shade(color, -40));
  } else if (shape === 'arrow') {
    px(7, 24, 2, 6, '#8a6034');
    px(9, 22, 2, 6, '#b8874e');
    px(11, 20, 2, 6, '#8a6034');
    for (let i = 0; i < 4; i += 1) px(13 + i * 2, 18 - i * 2, 2, 4, '#c9c3a4');
    px(21, 4, 4, 4, '#d8dde6');
    px(22, 6, 2, 2, '#8f99a8');
  } else if (shape === 'armor') {
    ctx.fillStyle = hex(color);
    ctx.beginPath();
    ctx.moveTo(9, 6); ctx.lineTo(23, 6); ctx.lineTo(27, 12);
    ctx.lineTo(23, 16); ctx.lineTo(26, 27); ctx.lineTo(6, 27);
    ctx.lineTo(9, 16); ctx.lineTo(5, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(color, 30);
    ctx.fillRect(14, 8, 4, 16);
    ctx.fillStyle = shade(color, -45);
    ctx.fillRect(9, 24, 14, 2);
    ctx.fillRect(7, 12, 3, 3);
    ctx.fillRect(22, 12, 3, 3);
  } else if (shape === 'shield') {
    ctx.fillStyle = hex(color);
    ctx.beginPath();
    ctx.moveTo(16, 4); ctx.lineTo(27, 8); ctx.lineTo(25, 20);
    ctx.lineTo(16, 28); ctx.lineTo(7, 20); ctx.lineTo(5, 8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = shade(color, -55); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = shade(color, 45);
    ctx.fillRect(15, 8, 2, 15);
    ctx.fillRect(10, 13, 12, 2);
  } else if (shape === 'ring') {
    ctx.strokeStyle = hex(color);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(16, 19, 8, 0, Math.PI * 2);
    ctx.stroke();
    px(12, 6, 8, 7, hex(color));
    px(13, 7, 3, 2, 'rgba(255,255,255,.7)');
  } else if (shape === 'axe') {
    px(14, 4, 3, 22, '#8a6034');
    px(15, 4, 1, 22, '#b8874e');
    px(8, 4, 12, 6, hex(color));
    px(6, 8, 4, 4, shade(color, -40));
    px(20, 8, 4, 4, shade(color, -40));
  } else if (shape === 'pickaxe') {
    px(14, 2, 3, 22, '#8a6034');
    px(15, 2, 1, 22, '#b8874e');
    px(8, 2, 12, 6, hex(color));
    px(6, 4, 4, 4, shade(color, -40));
    px(20, 4, 4, 4, shade(color, -40));
  } else if (shape === 'wood') {
    px(6, 10, 20, 14, hex(color));
    px(8, 12, 16, 10, shade(color, 25));
    px(10, 14, 4, 6, shade(color, -35));
    px(18, 14, 4, 6, shade(color, -35));
  } else {
    px(9, 8, 14, 4, shade(color, 25));
    px(14, 12, 4, 12, shade(color, -40));
  }

  ctx.restore();
}

export function makeItemIcon(def, size = 32) {
  const canvas = document.createElement('canvas');
  drawItemIcon(canvas, def, size);
  return canvas;
}

export function slotLabel(slot) {
  return {
    helmet: 'Casco', armor: 'Armadura', legs: 'Pantalón', boots: 'Botas',
    weapon: 'Mano', shield: 'Escudo', ring: 'Anillo', amulet: 'Collar', tool: 'Herramienta',
  }[slot] ?? slot;
}
