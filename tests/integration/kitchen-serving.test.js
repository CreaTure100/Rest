'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

describe('API: кухня и подача блюд', () => {
  let ctx;
  let chef;
  let waiter;
  let client;
  let orderId;
  let queue;

  before(() => h.start());
  after(() => h.stop());

  beforeEach(async () => {
    ctx = await h.resetData();
    [chef, waiter, client] = await Promise.all([h.tokenFor('chef'), h.tokenFor('waiter'), h.tokenFor('client')]);
    await h.book(client, 3, '12:00-13:00');
    const created = await h.api('POST', '/api/orders', {
      token: client,
      body: {
        tableId: 3,
        timeSlot: '12:00-13:00',
        dishes: [
          { dishId: ctx.dishes[0].id, quantity: 2, comment: 'без базилика' },
          { dishId: ctx.dishes[1].id, quantity: 1 },
        ],
      },
    });
    orderId = created.body.order.id;
    queue = (await h.api('GET', '/api/kitchen/queue', { token: chef })).body;
  });

  const start = (id, token = chef) => h.api('PUT', `/api/kitchen/dish/${id}/start`, { token });
  const complete = (id, token = chef) => h.api('PUT', `/api/kitchen/dish/${id}/complete`, { token });
  const serve = (index, token = waiter) => h.api('PUT', `/api/orders/${orderId}/dish/${index}/serve`, { token });
  const cook = async (id) => {
    assert.equal((await start(id)).status, 200);
    assert.equal((await complete(id)).status, 200);
  };

  describe('очередь кухни', () => {
    it('содержит позиции заказа; id очереди = id позиции заказа', async () => {
      assert.equal(queue.length, 2);
      const items = await h.db('order_items').orderBy('position');
      assert.deepEqual(queue.map((q) => q.id), items.map((i) => i.id));
      assert.deepEqual(
        { dishName: queue[0].dishName, quantity: queue[0].quantity, status: queue[0].status, tableId: queue[0].tableId, timeSlot: queue[0].timeSlot },
        { dishName: 'Брускетта', quantity: 2, status: 'pending', tableId: 3, timeSlot: '12:00-13:00' },
      );
    });
    it('передаёт комментарий гостя к блюду', async () => {
      assert.equal(queue[0].comment, 'без базилика');
      assert.equal(queue[1].comment, '');
    });
    it('очередь отсортирована по времени брони', async () => {
      await h.book(client, 4, '09:00-10:00');
      await h.api('POST', '/api/orders', { token: client, body: { tableId: 4, timeSlot: '09:00-10:00', dishes: [{ dishId: ctx.dishes[2].id, quantity: 1 }] } });
      const q = (await h.api('GET', '/api/kitchen/queue', { token: chef })).body;
      assert.equal(q[0].timeSlot, '09:00-10:00');
    });
    it('доступна повару и администратору, но не клиенту и не официанту', async () => {
      assert.equal((await h.api('GET', '/api/kitchen/queue', { token: await h.tokenFor('admin') })).status, 200);
      assert.equal((await h.api('GET', '/api/kitchen/queue', { token: client })).status, 403);
      assert.equal((await h.api('GET', '/api/kitchen/queue', { token: waiter })).status, 403);
      assert.equal((await h.api('GET', '/api/kitchen/queue')).status, 401);
    });
  });

  describe('приготовление', () => {
    it('начало приготовления переводит блюдо в cooking', async () => {
      const r = await start(queue[0].id);
      assert.equal(r.status, 200);
      assert.equal(r.body.item.status, 'cooking');
      assert.equal((await h.db('order_items').where({ id: queue[0].id }).first()).started_at !== null, true);
    });
    it('повторное начало приготовления запрещено', async () => {
      await start(queue[0].id);
      const again = await start(queue[0].id);
      assert.equal(again.status, 400);
      assert.match(again.body.error, /готовится/);
    });
    it('одновременные старты одной позиции: успешен ровно один', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => start(queue[0].id)));
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(results.filter((r) => r.status === 400).length, 7);
    });
    it('завершение блюда, которое не готовится, запрещено', async () => {
      const r = await complete(queue[0].id);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /не начали/);
    });
    it('завершение переводит cooking в ready; повторное завершение запрещено', async () => {
      await start(queue[0].id);
      const r = await complete(queue[0].id);
      assert.equal(r.status, 200);
      assert.equal(r.body.item.status, 'ready');
      assert.equal((await complete(queue[0].id)).status, 400);
      assert.equal((await start(queue[0].id)).status, 400); // уже готово
    });
    it('несуществующая позиция: 404; некорректный id: 400', async () => {
      assert.equal((await start(99999)).status, 404);
      assert.equal((await h.api('PUT', '/api/kitchen/dish/abc/start', { token: chef })).status, 400);
    });
    it('приготовление доступно только кухне', async () => {
      assert.equal((await start(queue[0].id, waiter)).status, 403);
      assert.equal((await start(queue[0].id, client)).status, 403);
    });
  });

  describe('рецепт', () => {
    it('возвращает рецепт и комментарии гостей по ещё не поданным заказам', async () => {
      const r = await h.api('GET', `/api/kitchen/recipe/${ctx.dishes[0].id}`, { token: chef });
      assert.equal(r.status, 200);
      assert.equal(r.body.name, 'Брускетта');
      assert.equal(r.body.recipe, 'Рецепт брускетты');
      assert.equal(r.body.cookingTime, '10 минут');
      assert.deepEqual(r.body.comments.map((c) => ({ tableId: c.tableId, comment: c.comment })), [{ tableId: 3, comment: 'без базилика' }]);
    });
    it('для блюда без комментариев список пуст; неизвестное блюдо: 404; клиенту: 403', async () => {
      assert.deepEqual((await h.api('GET', `/api/kitchen/recipe/${ctx.dishes[1].id}`, { token: chef })).body.comments, []);
      assert.equal((await h.api('GET', '/api/kitchen/recipe/99999', { token: chef })).status, 404);
      assert.equal((await h.api('GET', `/api/kitchen/recipe/${ctx.dishes[0].id}`, { token: client })).status, 403);
    });
  });

  describe('подача', () => {
    it('нельзя подать блюдо, которое ещё не готово', async () => {
      const r = await serve(0);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /не готово/);
      await start(queue[0].id);
      assert.equal((await serve(0)).status, 400); // cooking тоже не готово
    });
    it('подача уменьшает remaining на одну порцию; статус остаётся ready', async () => {
      await cook(queue[0].id);
      const r = await serve(0);
      assert.equal(r.status, 200);
      assert.equal(r.body.order.dishes[0].remaining, 1);
      assert.equal(r.body.order.dishes[0].total, 2);
      assert.equal(r.body.order.dishes[0].status, 'ready');
      assert.equal(r.body.order.completed, false);
    });
    it('последняя порция переводит блюдо в served; лишняя подача запрещена', async () => {
      await cook(queue[0].id);
      await serve(0);
      const last = await serve(0);
      assert.equal(last.body.order.dishes[0].remaining, 0);
      assert.equal(last.body.order.dishes[0].status, 'served');
      assert.equal((await serve(0)).status, 400);
    });
    it('заказ завершается после подачи всех блюд', async () => {
      await cook(queue[0].id);
      await cook(queue[1].id);
      await serve(0);
      await serve(0);
      const mid = await serve(1);
      assert.equal(mid.status, 200);
      assert.equal(mid.body.order.status, 'completed');
      assert.equal(mid.body.order.completed, true);
      const row = await h.db('orders').where({ id: orderId }).first();
      assert.equal(row.status, 'completed');
      assert.ok(row.completed_at);
    });
    it('заказ остаётся активным, пока не подано всё', async () => {
      await cook(queue[0].id);
      await serve(0);
      await serve(0);
      assert.equal((await h.api('GET', `/api/orders/${orderId}`, { token: waiter })).body.completed, false);
    });
    it('поданные позиции и завершённые заказы исчезают из очереди кухни', async () => {
      await cook(queue[1].id);
      await serve(1);
      const q = (await h.api('GET', '/api/kitchen/queue', { token: chef })).body;
      assert.deepEqual(q.map((i) => i.dishName), ['Брускетта']);
    });
    it('подача доступна официанту и администратору, но не повару и не клиенту', async () => {
      await cook(queue[1].id);
      assert.equal((await serve(1, chef)).status, 403);
      assert.equal((await serve(1, client)).status, 403);
      assert.equal((await serve(1, await h.tokenFor('admin'))).status, 200);
    });
    it('несуществующий заказ или позиция: 404; некорректные параметры: 400', async () => {
      assert.equal((await h.api('PUT', '/api/orders/99999/dish/0/serve', { token: waiter })).status, 404);
      assert.equal((await serve(7)).status, 404);
      assert.equal((await h.api('PUT', `/api/orders/${orderId}/dish/abc/serve`, { token: waiter })).status, 400);
    });
  });
});
