import { ITEMS, MONSTERS } from '../../shared/index.js';
import { Monster } from './monster.js';

/**
 * Acciones del panel de administrador.
 *
 * Este módulo NO decide quién es administrador: el llamador (gameServer) ya
 * validó el correo verificado del token y la flag `player.isAdmin`.
 */

/** Arma OP por clase; se otorgan las tres y se equipa la de la clase actual. */
const OP_WEAPONS = Object.freeze(['sword_admin', 'bow_admin', 'staff_admin']);
const OP_BY_CLASS = Object.freeze({
  knight: 'sword_admin',
  archer: 'bow_admin',
  mage: 'staff_admin',
});

export const ADMIN_ACTIONS = Object.freeze([
  'level_up',
  'invisible',
  'god',
  'summon',
  'op_weapon',
]);

/** Estado que el cliente usa para pintar los botones del panel. */
export function adminState(player) {
  return {
    isAdmin: true,
    invisible: player?.invisible === true,
    godMode: player?.godMode === true,
  };
}

/** Ejecuta una acción y devuelve { ok, message?, error? }. */
export function executeAdminAction(game, player, action) {
  switch (action) {
    case 'level_up': return levelUp(game, player);
    case 'invisible': return toggleInvisible(game, player);
    case 'god': return toggleGod(game, player);
    case 'summon': return summonMob(game, player);
    case 'op_weapon': return grantOpWeapon(game, player);
    default: return { ok: false, error: 'Acción de administrador desconocida' };
  }
}

function levelUp(game, player) {
  if (player.level >= 200) return { ok: false, error: 'Nivel máximo alcanzado' };
  player.level += 1;
  player.recalc();
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  player.dirty = true;
  game.sendEvent(player, 'level_up', { level: player.level });
  game.sendProfile(player);
  game.savePlayer(player);
  return { ok: true, message: `Nivel ${player.level} alcanzado` };
}

function toggleInvisible(game, player) {
  player.invisible = !player.invisible;
  // El propio admin sigue viéndose: su estado viaja en `self`, no en `e`.
  game.sendEvent(player, 'admin_state', adminState(player));
  game.forceSnapshot(player);
  return {
    ok: true,
    message: player.invisible
      ? 'Invisibilidad activada: los demás jugadores no te ven'
      : 'Invisibilidad desactivada',
  };
}

function toggleGod(game, player) {
  player.godMode = !player.godMode;
  // Al activarlo se corta el aggro actual: los mobs lo reevalúan en el tick.
  if (player.godMode) {
    for (const monster of game.world.monsters.values()) {
      if (monster.targetId === player.id) monster.targetId = null;
    }
  }
  game.sendEvent(player, 'admin_state', adminState(player));
  game.sendProfile(player);
  return {
    ok: true,
    message: player.godMode
      ? 'Modo Dios activado: los mobs no te agreden'
      : 'Modo Dios desactivado',
  };
}

function summonMob(game, player) {
  const defIds = Object.keys(MONSTERS);
  if (!defIds.length) return { ok: false, error: 'No hay monstruos definidos' };
  const idx = (player.adminSummonSeq ?? 0) % defIds.length;
  player.adminSummonSeq = (player.adminSummonSeq ?? 0) + 1;
  const defId = defIds[idx];

  const spot = game.world.findFreeAdjacent(Math.round(player.x), Math.round(player.y))
    ?? { x: Math.round(player.x), y: Math.round(player.y) };
  const monster = new Monster({
    id: `m_${++game.world.monsterCounter}`,
    defId,
    spawn: spot,
  });
  monster.nextMoveAt = Date.now() + 400;
  game.world.addMonster(monster);
  return { ok: true, message: `Invocado: ${MONSTERS[defId].name}` };
}

function grantOpWeapon(game, player) {
  let granted = 0;
  for (const itemId of OP_WEAPONS) {
    if (!ITEMS[itemId]) continue;
    if (player.countItem(itemId) > 0) continue;
    if (player.equipment?.mano?.itemId === itemId) continue;
    if (player.addItem(itemId, 1).added > 0) granted += 1;
  }
  // El arco necesita munición para atacar.
  player.addItem('arrow', 999);

  const wanted = OP_BY_CLASS[player.classId] ?? 'sword_admin';
  const slot = player.inventory.find((inst) => inst?.itemId === wanted);
  let equipped = false;
  if (slot) {
    player.nextSwitchAt = 0; // ignora el cooldown de cambio de arma
    equipped = player.equipUid(slot.uid, Date.now()).ok;
  }

  if (granted === 0 && !equipped) {
    return { ok: false, error: 'Mochila llena: no se pudo añadir el arma OP' };
  }
  player.dirty = true;
  game.sendProfile(player);
  game.savePlayer(player);
  return {
    ok: true,
    message: equipped ? 'Arma OP equipada' : 'Arma OP añadida a la mochila',
  };
}
