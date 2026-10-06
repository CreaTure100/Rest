'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

describe('API: заказы', () => {
  let ctx;
  let client;
  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    ctx = await h.resetData();
    client = await h.tokenFor('client');
  });

  const dish = (i) => ctx.dishes[i];
  const order = (token, body) => h.api('POST', '/api/orders', { token, body });
  const basic = (over = {}) => ({
    tableId: 3,
    timeSlot: '12:00-13:00',
    dishes: [{ dishId: dish(0).id, quantity: 2, comment: 'без базилика' }, { dishId: dish(1).id, quantity: 1 }],
    ...over,
  });

  describe('создание', () => {
    it('создаёт заказ для забронированного стола и возвращает полную структуру', async () => {
      await h.book(client, 3, '12:00-13:00');
      const r = await order(client, basic({ clientName: 'Алексей' }));
      assert.equal(r.status, 201);
      const o = r.body.order;
      assert.equal(o.tableId, 3);
      assert.equal(o.timeSlot, '12:00-13:00');
      assert.equal(o.sortMinutes, 720);
      assert.equal(o.status, 'active');
      assert.equal(o.completed, false);
      assert.equal(o.clientId, ctx.users.client.id);
      assert.equal(o.clientName, 'Алексей');
      assert.equal(o.totalPrice, 2 * 320 + 580);
      assert.equal(o.dishes.length, 2);
      assert.deepEqual(
        { name: o.dishes[0].name, total: o.dishes[0].total, remaining: o.dishes[0].remaining, status: o.dishes[0].status, comment: o.dishes[0].comment },
        { name: 'Брускетта', total: 2, remaining: 2, status: 'pending', comment: 'без базилика' },
      );
      assert.ok(o.createdAt);
    });
    it('сохраняет комментарии в позициях заказа в БД', async () => {
      await h.book(client, 3, '12:00-13:00');
      await order(client, basic());
      const items = await h.db('order_items').orderBy('position');
      assert.deepEqual(items.map((i) => i.comment), ['без базилика', '']);
    });
    it('название и цена берутся из меню, а не из запроса', async () => {
      await h.book(client, 3, '12:00-13:00');
      const r = await order(client, { ...basic(), dishes: [{ dishId: dish(2).id, quantity: 1, name: 'Взлом', price: 1 }] });
      assert.equal(r.body.order.dishes[0].name, 'Тирамису');
      assert.equal(r.body.order.totalPrice, 380);
    });
    it('цена в заказе фиксируется: смена цены в меню не меняет старый заказ', async () => {
      await h.book(client, 3, '12:00-13:00');
      const created = await order(client, basic());
      await h.api('PUT', `/api/menu/${dish(0).id}`, { token: await h.tokenFor('admin'), body: { price: 999 } });
      const again = await h.api('GET', `/api/orders/${created.body.order.id}`, { token: client });
      assert.equal(again.body.totalPrice, 2 * 320 + 580);
    });
    it('заказ можно оформить на время внутри более длинной брони', async () => {
      await h.book(client, 3, '12:00-15:00');
      assert.equal((await order(client, basic({ timeSlot: '13:00-14:00' }))).status, 201);
    });
  });

  describe('запреты', () => {
    it('заказ без блюд: 400', async () => {
      await h.book(client, 3, '12:00-13:00');
      assert.equal((await order(client, basic({ dishes: [] }))).status, 400);
      assert.equal((await order(client, { tableId: 3, timeSlot: '12:00-13:00' })).status, 400);
    });
    it('заказ без бронирования: 409, бронь не создаётся', async () => {
      const r = await order(client, basic());
      assert.equal(r.status, 409);
      assert.match(r.body.error, /не забронирован/);
      assert.equal((await h.db('bookings')).length, 0);
      assert.equal((await h.db('orders')).length, 0);
    });
    it('заказ на время, не покрытое бронью: 409', async () => {
      await h.book(client, 3, '12:00-13:00');
      assert.equal((await order(client, basic({ timeSlot: '12:30-14:00' }))).status, 409);
    });
    it('чужая бронь недоступна другому клиенту: 403', async () => {
      await h.book(client, 3, '12:00-13:00');
      const r = await order(await h.tokenFor('client2'), basic());
      assert.equal(r.status, 403);
      assert.equal((await h.db('orders')).length, 0);
    });
    it('неизвестное блюдо, некорректное количество и dishId: 400 и ничего не сохраняется', async () => {
      await h.book(client, 3, '12:00-13:00');
      const bad = [
        [{ dishId: 99999, quantity: 1 }],
        [{ dishId: dish(0).id, quantity: 0 }],
        [{ dishId: dish(0).id, quantity: -2 }],
        [{ dishId: dish(0).id, quantity: 1.5 }],
        [{ dishId: dish(0).id, quantity: 1000 }],
        [{ dishId: 'x', quantity: 1 }],
      ];
      for (const dishes of bad) assert.equal((await order(client, basic({ dishes }))).status, 400, JSON.stringify(dishes));
      assert.equal((await h.db('orders')).length, 0);
    });
    it('скрытое из меню блюдо заказать нельзя', async () => {
      await h.book(client, 3, '12:00-13:00');
      await h.api('DELETE', `/api/menu/${dish(0).id}`, { token: await h.tokenFor('admin') });
      assert.equal((await order(client, basic())).status, 400);
    });
    it('требует авторизации', async () => {
      assert.equal((await order(undefined, basic())).status, 401);
    });
  });

  describe('бронь и заказ одной операцией (book: true)', () => {
    it('создаёт бронь и заказ атомарно', async () => {
      const r = await order(client, basic({ book: true }));
      assert.equal(r.status, 201);
      assert.equal((await h.db('bookings')).length, 1);
      assert.equal((await h.db('orders')).length, 1);
      assert.equal((await h.api('GET', '/api/tables', { token: client })).body.find((t) => t.id === 3).status, 'partial');
    });
    it('при конфликте брони заказ не создаётся и новая бронь не остаётся', async () => {
      await h.book(await h.tokenFor('client2'), 3, '12:30-13:30');
      const r = await order(client, basic({ book: true }));
      assert.equal(r.status, 409);
      assert.equal((await h.db('orders')).length, 0);
      assert.equal((await h.db('bookings')).length, 1);
    });
    it('использует существующую бронь того же гостя, не создавая вторую', async () => {
      await h.book(client, 3, '12:00-13:00');
      assert.equal((await order(client, basic({ book: true }))).status, 201);
      assert.equal((await h.db('bookings')).length, 1);
    });
    it('к одной брони можно оформить несколько заказов', async () => {
      await h.book(client, 3, '12:00-14:00');
      assert.equal((await order(client, basic())).status, 201);
      assert.equal((await order(client, basic())).status, 201);
      assert.equal((await h.db('orders')).length, 2);
    });
  });

  describe('получение заказов', () => {
    let clientOrderId;
    beforeEach(async () => {
      const client2 = await h.tokenFor('client2');
      await h.book(client, 3, '12:00-13:00');
      await h.book(client2, 4, '14:00-15:00');
      clientOrderId = (await order(client, basic())).body.order.id;
      await order(client2, basic({ tableId: 4, timeSlot: '14:00-15:00' }));
    });

    it('сотрудники видят все заказы', async () => {
      for (const who of ['waiter', 'chef', 'admin']) {
        const r = await h.api('GET', '/api/orders', { token: await h.tokenFor(who) });
        assert.equal(r.status, 200);
        assert.equal(r.body.length, 2, who);
      }
    });
    it('клиент видит только свои заказы', async () => {
      const r = await h.api('GET', '/api/orders', { token: client });
      assert.equal(r.body.length, 1);
      assert.equal(r.body[0].id, clientOrderId);
    });
    it('/orders/my возвращает заказы текущего клиента', async () => {
      const r = await h.api('GET', '/api/orders/my', { token: client });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.map((o) => o.id), [clientOrderId]);
    });
    it('чужой заказ по id недоступен клиенту (403), владельцу и сотруднику доступен', async () => {
      const otherId = (await h.api('GET', '/api/orders', { token: await h.tokenFor('admin') })).body.find((o) => o.id !== clientOrderId).id;
      assert.equal((await h.api('GET', `/api/orders/${otherId}`, { token: client })).status, 403);
      assert.equal((await h.api('GET', `/api/orders/${clientOrderId}`, { token: client })).status, 200);
      assert.equal((await h.api('GET', `/api/orders/${otherId}`, { token: await h.tokenFor('waiter') })).status, 200);
      assert.equal((await h.api('GET', '/api/orders/99999', { token: client })).status, 404);
    });
    it('поддерживает фильтры и проверяет их значения', async () => {
      const admin = await h.tokenFor('admin');
      assert.equal((await h.api('GET', '/api/orders?status=active&limit=1', { token: admin })).body.length, 1);
      assert.equal((await h.api('GET', '/api/orders?status=bogus', { token: admin })).status, 400);
      assert.equal((await h.api('GET', '/api/orders?limit=0', { token: admin })).status, 400);
    });
  });

  it('официант оформляет заказ на бронь клиента; заказ принадлежит клиенту', async () => {
    await h.book(client, 3, '12:00-13:00');
    const r = await order(await h.tokenFor('waiter'), basic({ clientName: 'Гость стола 3' }));
    assert.equal(r.status, 201);
    assert.equal(r.body.order.clientId, ctx.users.client.id);
    assert.equal((await h.api('GET', '/api/orders/my', { token: client })).body.length, 1);
  });
});
