import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVENTORY_SLOTS,
  addItem,
  countItem,
  createStarterInventory,
  emptyInventory,
  findFreeSlots,
  hasSpaceFor,
  normalizeInventory,
  removeItemById,
  removeItemByUid,
  totalSellValue,
} from '../src/index.js';

test('el inventario vacío tiene el tamaño configurado', () => {
  const inv = emptyInventory();
  assert.equal(inv.length, INVENTORY_SLOTS);
  assert.equal(findFreeSlots(inv), INVENTORY_SLOTS);
  assert.equal(normalizeInventory([null]).length, INVENTORY_SLOTS);
  assert.equal(createStarterInventory().length, 8);
});

test('los apilables se agrupan en un solo slot', () => {
  const inv = emptyInventory();
  assert.deepEqual(addItem(inv, 'potion_hp', 5), { added: 5, left: 0 });
  assert.deepEqual(addItem(inv, 'potion_hp', 7), { added: 7, left: 0 });
  assert.equal(countItem(inv, 'potion_hp'), 12);
  assert.equal(inv.filter(Boolean).length, 1);
  assert.equal(inv[0].qty, 12);
});

test('los no apilables ocupan un slot por unidad', () => {
  const inv = emptyInventory();
  const result = addItem(inv, 'sword_iron', 3);
  assert.equal(result.added, 3);
  assert.equal(result.left, 0);
  assert.equal(inv.filter((s) => s?.itemId === 'sword_iron').length, 3);
  assert.ok(hasSpaceFor(inv, 'sword_iron', 1));
});

test('no se añaden ítems si no hay espacio', () => {
  const inv = emptyInventory();
  const result = addItem(inv, 'sword_iron', INVENTORY_SLOTS + 2);
  assert.equal(result.added, INVENTORY_SLOTS);
  assert.equal(result.left, 2);
  assert.equal(findFreeSlots(inv), 0);
  assert.equal(hasSpaceFor(inv, 'sword_iron', 1), false);
});

test('la bolsa devuelve izquierdo cuando el ítem no existe', () => {
  const inv = emptyInventory();
  assert.deepEqual(addItem(inv, 'no_existe', 2), { added: 0, left: 2 });
});

test('removeItemByUid respeta la cantidad y limpia el slot', () => {
  const inv = emptyInventory();
  addItem(inv, 'potion_mp', 10);
  const uid = inv[0].uid;
  const partial = removeItemByUid(inv, uid, 4);
  assert.equal(partial.removed, 4);
  assert.equal(inv[0].qty, 6);
  removeItemByUid(inv, uid, 99);
  assert.equal(inv[0], null);
});

test('removeItemById reparte entre stacks', () => {
  const inv = emptyInventory();
  addItem(inv, 'arrow', 5);
  inv[2] = { uid: 'arrow-extra', itemId: 'arrow', qty: 7 };
  const result = removeItemById(inv, 'arrow', 9);
  assert.equal(result.removed, 9);
  assert.equal(countItem(inv, 'arrow'), 3);
});

test('totalSellValue suma el valor de venta', () => {
  const inv = emptyInventory();
  addItem(inv, 'potion_hp', 2);
  addItem(inv, 'sword_iron', 1);
  assert.equal(totalSellValue(inv), 4 * 2 + 60);
});
