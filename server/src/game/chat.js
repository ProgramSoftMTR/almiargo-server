import { CHAT_CHANNELS, CHAT_COLORS, CONSTANTS } from '../../shared/index.js';

const clean = (text) => String(text ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, CONSTANTS.MAX_CHAT_LENGTH);

const normalizeName = (name) => String(name ?? '').toLowerCase();

/**
 * Chat con canales, comandos básicos y rate-limit.
 * El cliente pinta con textContent (nunca HTML) para evitar XSS.
 */
export function handleChat(game, session, msg, now = Date.now()) {
  const player = session.player;
  if (!player) return { ok: false, error: 'No autenticado' };

  session.chatTimes = (session.chatTimes ?? []).filter((t) => now - t < 10000);
  if (session.chatTimes.length >= 6) return { ok: false, error: 'Demasiados mensajes, espera un poco' };

  let text = clean(msg.text);
  if (!text) return { ok: false, error: 'Mensaje vacío' };

  // Comandos
  if (text.startsWith('/')) {
    const [cmd, ...args] = text.slice(1).split(' ');
    if (cmd.toLowerCase() === 'clan') {
      const name = args.join(' ').trim().slice(0, 16);
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, error: 'Nombre de clan inválido (3-16)' };
      player.clan = name;
      player.dirty = true;
      game.sendEvent(player, 'notice', { text: `Ahora perteneces al clan ${name}` });
      game.sendProfile(player);
      return { ok: true };
    }
    if (cmd.toLowerCase() === 'leaveclan') {
      player.clan = null;
      player.dirty = true;
      game.sendProfile(player);
      return { ok: true };
    }
    if (cmd.toLowerCase() === 'help') {
      game.sendChat(session, {
        channel: 'system', from: 'Sistema',
        text: '/clan <nombre> · /leaveclan · Canales: global, local, clan, privado',
      });
      return { ok: true };
    }
    return { ok: false, error: 'Comando desconocido' };
  }

  const channel = CHAT_CHANNELS.includes(msg.channel) ? msg.channel : 'local';
  const payload = {
    channel,
    from: player.name,
    text,
    at: now,
    color: CHAT_COLORS[channel],
  };
  session.chatTimes.push(now);

  if (channel === 'global') {
    game.broadcastAllChat(payload);
  } else if (channel === 'local') {
    game.broadcastLocalChat(player.x, player.y, 16, payload);
  } else if (channel === 'clan') {
    if (!player.clan) return { ok: false, error: 'No tienes clan. Usa /clan <nombre>' };
    game.broadcastClanChat(player.clan, { ...payload, clan: player.clan });
  } else if (channel === 'private') {
    const target = game.findPlayerByName(msg.to);
    if (!target) return { ok: false, error: 'Jugador no encontrado' };
    if (target.id === player.id) return { ok: false, error: 'No puedes susurrarte' };
    const privatePayload = { ...payload, to: target.name };
    game.sendChatToPlayer(target, privatePayload);
    game.sendChat(session, privatePayload);
  }
  return { ok: true };
}

export { clean as sanitizeChat, normalizeName };
