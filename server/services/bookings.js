'use strict';

const db = require('../db');
const { notFound, conflict } = require('../lib/errors');
const { computeTableStatus, findOverlap, formatSlot } = require('../lib/timeSlots');
const { toApiTable } = require('../lib/mappers');

const asSlot = (b) => ({ start: b.start_minute, end: b.end_minute });

async function listTables(date) {
  const [tables, bookings] = await Promise.all([
    db('tables').orderBy('id'),
    db('bookings').where({ booking_date: date }).select('table_id', 'start_minute', 'end_minute'),
  ]);
  const byTable = new Map();
  for (const b of bookings) {
    if (!byTable.has(b.table_id)) byTable.set(b.table_id, []);
    byTable.get(b.table_id).push(asSlot(b));
  }
  return tables.map((t) => toApiTable(t, byTable.get(t.id) || []));
}

async function getTable(tableId, date, conn = db) {
  const table = await conn('tables').where({ id: tableId }).first();
  if (!table) throw notFound('Стол не найден');
  const bookings = await conn('bookings').where({ table_id: tableId, booking_date: date }).select('start_minute', 'end_minute');
  return toApiTable(table, bookings.map(asSlot));
}

/**
 * Блокирует строку стола до конца транзакции. Все операции брони/заказа по одному столу
 * выполняются строго по очереди, поэтому "проверил - создал" не может раздвоиться.
 */
async function lockTable(trx, tableId) {
  const table = await trx('tables').where({ id: tableId }).forUpdate().first();
  if (!table) throw notFound('Стол не найден');
  return table;
}

/** Создание брони; вызывать внутри транзакции ПОСЛЕ lockTable. */
async function createBookingLocked(trx, { tableId, userId, date, slot }) {
  const existing = (await trx('bookings').where({ table_id: tableId, booking_date: date }).select('start_minute', 'end_minute')).map(asSlot);

  if (computeTableStatus(existing) === 'booked') throw conflict('Стол полностью занят на выбранную дату');
  const clash = findOverlap(slot, existing);
  if (clash) throw conflict('Это время уже забронировано', { conflictingSlot: formatSlot(clash.start, clash.end) });

  try {
    const [booking] = await trx('bookings')
      .insert({ table_id: tableId, user_id: userId, booking_date: date, start_minute: slot.start, end_minute: slot.end })
      .returning('*');
    return booking;
  } catch (err) {
    // последний рубеж: EXCLUDE-ограничение в БД
    if (err.code === '23P01') throw conflict('Это время уже забронировано');
    throw err;
  }
}

async function createBooking({ tableId, userId, date, slot }) {
  return db.transaction(async (trx) => {
    await lockTable(trx, tableId);
    const booking = await createBookingLocked(trx, { tableId, userId, date, slot });
    return { booking, table: await getTable(tableId, date, trx) };
  });
}

module.exports = { listTables, getTable, lockTable, createBookingLocked, createBooking, asSlot };
