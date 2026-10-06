'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

describe('API: столики и бронирование', () => {
  let client;
  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.resetData();
    client = await h.tokenFor('client');
  });

  const tableById = async (id, query = '') => (await h.api('GET', `/api/tables${query}`, { token: client })).body.find((t) => t.id === id);

  it('возвращает 17 столиков, все свободны', async () => {
    const r = await h.api('GET', '/api/tables', { token: client });
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 17);
    assert.ok(r.body.every((t) => t.status === 'free' && t.slots.length === 0));
  });
  it('список столиков и бронирование требуют авторизации', async () => {
    assert.equal((await h.api('GET', '/api/tables')).status, 401);
    assert.equal((await h.api('POST', '/api/tables/1/book', { body: { timeSlot: '12:00-13:00' } })).status, 401);
  });

  describe('успешное бронирование', () => {
    it('бронирует свободный стол; статус становится partial, слот виден в списке', async () => {
      const r = await h.book(client, 3, '12:00-13:00');
      assert.equal(r.status, 201);
      assert.equal(r.body.bookedSlot, '12:00-13:00');
      assert.equal(r.body.table.status, 'partial');
      const t = await tableById(3);
      assert.equal(t.status, 'partial');
      assert.deepEqual(t.slots, ['12:00-13:00']);
    });
    it('смежные интервалы разрешены (конец одной брони = начало другой)', async () => {
      assert.equal((await h.book(client, 3, '12:00-13:00')).status, 201);
      assert.equal((await h.book(client, 3, '13:00-14:00')).status, 201);
      assert.deepEqual((await tableById(3)).slots, ['12:00-13:00', '13:00-14:00']);
    });
    it('допускает минимальные 30 минут и границы рабочего дня', async () => {
      assert.equal((await h.book(client, 4, '09:00-09:30')).status, 201);
      assert.equal((await h.book(client, 4, '22:30-23:00')).status, 201);
    });
    it('бронь на другую дату не влияет на статус сегодняшнего дня', async () => {
      const tomorrow = h.daysFromToday(1);
      assert.equal((await h.book(client, 5, '12:00-13:00', { date: tomorrow })).status, 201);
      assert.equal((await tableById(5)).status, 'free');
      assert.equal((await tableById(5, `?date=${tomorrow}`)).status, 'partial');
    });
  });

  describe('некорректные данные', () => {
    it('меньше 30 минут: 400', async () => {
      const r = await h.book(client, 3, '12:00-12:20');
      assert.equal(r.status, 400);
      assert.match(r.body.error, /30 минут/);
    });
    it('вне рабочего времени: 400', async () => {
      for (const slot of ['08:00-09:30', '22:00-23:30', '00:00-01:00']) {
        const r = await h.book(client, 3, slot);
        assert.equal(r.status, 400, slot);
        assert.match(r.body.error, /9:00 до 23:00/);
      }
    });
    it('неверный формат или отсутствие времени: 400', async () => {
      for (const slot of ['abc', '12:00', '25:00-26:00', '13:00-12:00', '']) {
        assert.equal((await h.book(client, 3, slot)).status, 400, JSON.stringify(slot));
      }
      assert.equal((await h.api('POST', '/api/tables/3/book', { token: client, body: {} })).status, 400);
    });
    it('несуществующий стол: 404; некорректный номер: 400', async () => {
      assert.equal((await h.book(client, 99, '12:00-13:00')).status, 404);
      assert.equal((await h.book(client, 'abc', '12:00-13:00')).status, 400);
    });
    it('прошедшая и невалидная дата: 400', async () => {
      assert.equal((await h.book(client, 3, '12:00-13:00', { date: h.daysFromToday(-1) })).status, 400);
      assert.equal((await h.book(client, 3, '12:00-13:00', { date: '2026-02-30' })).status, 400);
    });
  });

  describe('конфликты', () => {
    it('пересекающееся бронирование запрещено: 409', async () => {
      assert.equal((await h.book(client, 3, '12:00-14:00')).status, 201);
      for (const slot of ['12:30-13:30', '11:00-12:30', '13:30-15:00', '12:00-14:00', '12:30-13:00']) {
        const r = await h.book(client, 3, slot);
        assert.equal(r.status, 409, slot);
        assert.match(r.body.error, /уже забронировано/);
      }
      assert.equal((await h.db('bookings').where({ table_id: 3 })).length, 1);
    });
    it('полностью занятый стол недоступен: статус booked и 409', async () => {
      assert.equal((await h.book(client, 6, '09:00-23:00')).status, 201);
      assert.equal((await tableById(6)).status, 'booked');
      const r = await h.book(client, 6, '12:00-13:00');
      assert.equal(r.status, 409);
      assert.match(r.body.error, /полностью занят/);
    });
    it('стол с остатками меньше 30 минут тоже считается занятым', async () => {
      await h.book(client, 7, '09:00-12:00');
      await h.book(client, 7, '12:20-23:00');
      assert.equal((await tableById(7)).status, 'booked');
    });
    it('стол со свободным окном остаётся доступным (partial)', async () => {
      await h.book(client, 8, '10:00-14:00');
      await h.book(client, 8, '15:00-18:00');
      assert.equal((await tableById(8)).status, 'partial');
      assert.equal((await h.book(client, 8, '14:00-15:00')).status, 201); // окно между бронями
    });
  });

  it('параллельные запросы на один интервал: бронь получает ровно один', async () => {
    const tokens = [client, await h.tokenFor('client2'), await h.tokenFor('waiter')];
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => h.book(tokens[i % tokens.length], 9, '18:00-20:00')),
    );
    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(created.length, 1, `статусы: ${results.map((r) => r.status).join(',')}`);
    assert.equal(conflicts.length, 14);
    assert.equal((await h.db('bookings').where({ table_id: 9 })).length, 1);
  });

  it('параллельные запросы на пересекающиеся интервалы не создают пересечений', async () => {
    const slots = ['10:00-12:00', '11:00-13:00', '12:00-14:00', '11:30-12:30', '10:30-11:30', '13:00-15:00'];
    await Promise.all(slots.flatMap((s) => [h.book(client, 10, s), h.book(client, 10, s)]));
    const rows = await h.db('bookings').where({ table_id: 10 }).orderBy('start_minute');
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i].start_minute >= rows[i - 1].end_minute, 'найдено пересечение броней');
    }
  });
});
