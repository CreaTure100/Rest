'use strict';

const DISH_STATUS = Object.freeze({
  PENDING: 'pending',
  COOKING: 'cooking',
  READY: 'ready',
  SERVED: 'served',
});

const toCents = (value) => Math.round(Number(value) * 100);

/** Сумма заказа в рублях. Считаем в копейках, чтобы не копить ошибку float. */
function orderTotal(items) {
  const cents = items.reduce((sum, item) => sum + toCents(item.unitPrice) * (Number(item.quantity) || 0), 0);
  return cents / 100;
}

/*
 * Жизненный цикл позиции заказа:
 *   pending -> cooking -> ready -> (подаётся по порции) -> served
 * Позиция готовится партией (quantity порций), а подаётся по одной порции (remaining--).
 */

function startCooking(item) {
  if (item.status === DISH_STATUS.PENDING && item.remaining > 0) {
    return { ok: true, item: { ...item, status: DISH_STATUS.COOKING } };
  }
  return { ok: false, error: `Блюдо уже ${item.status === DISH_STATUS.COOKING ? 'готовится' : 'готово'}` };
}

function completeCooking(item) {
  if (item.status !== DISH_STATUS.COOKING) return { ok: false, error: 'Блюдо не начали готовить' };
  return { ok: true, item: { ...item, status: DISH_STATUS.READY } };
}

function serveOne(item) {
  if (item.status !== DISH_STATUS.READY || item.remaining <= 0) {
    return { ok: false, error: 'Блюдо еще не готово к подаче' };
  }
  const remaining = item.remaining - 1;
  return {
    ok: true,
    item: { ...item, remaining, status: remaining === 0 ? DISH_STATUS.SERVED : DISH_STATUS.READY },
  };
}

/** Заказ завершён, когда все порции всех позиций поданы. */
const isOrderCompleted = (items) => items.length > 0 && items.every((i) => i.remaining === 0);

module.exports = { DISH_STATUS, orderTotal, startCooking, completeCooking, serveOne, isOrderCompleted };
