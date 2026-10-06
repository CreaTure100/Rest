'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

const NEW_DISH = { name: 'Панини', price: 420, category: 'Закуски', weight: '200г', recipe: 'Секрет панини', description: 'Горячий бутерброд' };

describe('API: меню', () => {
  let ctx;
  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    ctx = await h.resetData();
  });

  it('публично отдаёт список блюд без рецептов', async () => {
    const r = await h.api('GET', '/api/menu');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 3);
    assert.equal(r.body[0].name, 'Брускетта');
    assert.equal(typeof r.body[0].price, 'number');
    assert.equal(r.body.some((d) => 'recipe' in d), false);
  });
  it('администратор и повар видят рецепты', async () => {
    for (const who of ['admin', 'chef']) {
      const r = await h.api('GET', '/api/menu', { token: await h.tokenFor(who) });
      assert.equal(r.body[0].recipe, 'Рецепт брускетты', who);
    }
    const client = await h.api('GET', '/api/menu', { token: await h.tokenFor('client') });
    assert.equal('recipe' in client.body[0], false);
  });
  it('отдаёт отдельное блюдо и 404 для несуществующего', async () => {
    const ok = await h.api('GET', `/api/menu/${ctx.dishes[1].id}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.name, 'Карбонара');
    assert.equal((await h.api('GET', '/api/menu/99999')).status, 404);
    assert.equal((await h.api('GET', '/api/menu/abc')).status, 400);
  });

  describe('создание', () => {
    it('администратор создаёт блюдо; незаполненные поля получают значения по умолчанию', async () => {
      const r = await h.api('POST', '/api/menu', { token: await h.tokenFor('admin'), body: NEW_DISH });
      assert.equal(r.status, 201);
      assert.equal(r.body.name, 'Панини');
      assert.equal(r.body.image, '/images/default.jpg');
      assert.equal(r.body.recipe, 'Секрет панини');
      assert.equal((await h.api('GET', '/api/menu')).body.length, 4);
    });
    it('клиент, официант и повар создавать блюда не могут: 403', async () => {
      for (const who of ['client', 'waiter', 'chef']) {
        const r = await h.api('POST', '/api/menu', { token: await h.tokenFor(who), body: NEW_DISH });
        assert.equal(r.status, 403, who);
      }
    });
    it('без токена: 401', async () => {
      assert.equal((await h.api('POST', '/api/menu', { body: NEW_DISH })).status, 401);
    });
    it('проверяет обязательные поля и корректность цены', async () => {
      const token = await h.tokenFor('admin');
      for (const key of ['name', 'price', 'category', 'weight']) {
        const body = { ...NEW_DISH };
        delete body[key];
        assert.equal((await h.api('POST', '/api/menu', { token, body })).status, 400, `без ${key}`);
      }
      for (const price of [0, -10, 'abc']) {
        assert.equal((await h.api('POST', '/api/menu', { token, body: { ...NEW_DISH, price } })).status, 400, `цена ${price}`);
      }
    });
    it('игнорирует служебные поля из запроса (mass assignment)', async () => {
      const token = await h.tokenFor('admin');
      const r = await h.api('POST', '/api/menu', { token, body: { ...NEW_DISH, id: 777, is_active: false } });
      assert.equal(r.status, 201);
      assert.notEqual(r.body.id, 777);
      assert.equal((await h.api('GET', '/api/menu')).body.some((d) => d.id === r.body.id), true);
    });
  });

  describe('изменение и удаление', () => {
    it('администратор частично обновляет блюдо', async () => {
      const token = await h.tokenFor('admin');
      const id = ctx.dishes[0].id;
      const r = await h.api('PUT', `/api/menu/${id}`, { token, body: { price: 350 } });
      assert.equal(r.status, 200);
      assert.equal(r.body.price, 350);
      assert.equal(r.body.name, 'Брускетта'); // остальное не тронуто
    });
    it('клиент изменять блюдо не может', async () => {
      const r = await h.api('PUT', `/api/menu/${ctx.dishes[0].id}`, { token: await h.tokenFor('client'), body: { price: 1 } });
      assert.equal(r.status, 403);
    });
    it('обновление несуществующего блюда: 404; некорректная цена: 400', async () => {
      const token = await h.tokenFor('admin');
      assert.equal((await h.api('PUT', '/api/menu/99999', { token, body: { price: 100 } })).status, 404);
      assert.equal((await h.api('PUT', `/api/menu/${ctx.dishes[0].id}`, { token, body: { price: -1 } })).status, 400);
    });
    it('удаление скрывает блюдо из меню, но не ломает историю заказов', async () => {
      const token = await h.tokenFor('admin');
      const id = ctx.dishes[2].id;
      const r = await h.api('DELETE', `/api/menu/${id}`, { token });
      assert.equal(r.status, 200);
      assert.equal(r.body.remainingCount, 2);
      assert.equal((await h.api('GET', '/api/menu')).body.some((d) => d.id === id), false);
      assert.equal((await h.api('GET', `/api/menu/${id}`)).status, 404);
      assert.equal((await h.db('menu_items').where({ id }).first()).is_active, false); // запись сохранена
      assert.equal((await h.api('DELETE', `/api/menu/${id}`, { token })).status, 404);
    });
    it('клиент удалять блюдо не может', async () => {
      const r = await h.api('DELETE', `/api/menu/${ctx.dishes[0].id}`, { token: await h.tokenFor('client') });
      assert.equal(r.status, 403);
    });
  });
});
