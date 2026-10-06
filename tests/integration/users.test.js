'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

describe('API: пользователи', () => {
  let ctx;
  let admin;
  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    ctx = await h.resetData();
    admin = await h.tokenFor('admin');
  });

  describe('список', () => {
    it('администратор получает всех пользователей без паролей', async () => {
      const r = await h.api('GET', '/api/users', { token: admin });
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 5);
      assert.equal(JSON.stringify(r.body).toLowerCase().includes('password'), false);
    });
    it('другим ролям доступ запрещён: 403', async () => {
      for (const who of ['waiter', 'chef', 'client']) {
        assert.equal((await h.api('GET', '/api/users', { token: await h.tokenFor(who) })).status, 403, who);
      }
    });
    it('без токена: 401', async () => {
      assert.equal((await h.api('GET', '/api/users')).status, 401);
    });
  });

  describe('создание сотрудника', () => {
    const body = { name: 'Новый повар', email: 'Cook@Test.local', password: 'cookpass1', role: 'chef' };

    it('создаёт сотрудника с ролью; он может войти', async () => {
      const r = await h.api('POST', '/api/users/employee', { token: admin, body });
      assert.equal(r.status, 201);
      assert.equal(r.body.user.role, 'chef');
      assert.equal(r.body.user.email, 'cook@test.local');
      const loggedIn = await h.login('cook@test.local', 'cookpass1');
      assert.equal(loggedIn.user.role, 'chef');
    });
    it('клиент создавать сотрудников не может', async () => {
      assert.equal((await h.api('POST', '/api/users/employee', { token: await h.tokenFor('client'), body })).status, 403);
    });
    it('отклоняет дубликат email, неверную роль, слабый пароль и некорректный email', async () => {
      assert.equal((await h.api('POST', '/api/users/employee', { token: admin, body: { ...body, email: 'client@test.local' } })).status, 409);
      assert.equal((await h.api('POST', '/api/users/employee', { token: admin, body: { ...body, role: 'guest' } })).status, 400);
      assert.equal((await h.api('POST', '/api/users/employee', { token: admin, body: { ...body, role: 'superuser' } })).status, 400);
      assert.equal((await h.api('POST', '/api/users/employee', { token: admin, body: { ...body, password: '123' } })).status, 400);
      assert.equal((await h.api('POST', '/api/users/employee', { token: admin, body: { ...body, email: 'nope' } })).status, 400);
    });
  });

  describe('изменение', () => {
    it('меняет роль пользователя; новая роль действует сразу', async () => {
      const waiterToken = await h.tokenFor('waiter');
      assert.equal((await h.api('GET', '/api/kitchen/queue', { token: waiterToken })).status, 403);
      const r = await h.api('PUT', `/api/users/${ctx.users.waiter.id}`, { token: admin, body: { role: 'chef' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.user.role, 'chef');
      // тот же access-токен, но роль берётся из БД
      assert.equal((await h.api('GET', '/api/kitchen/queue', { token: waiterToken })).status, 200);
    });
    it('меняет имя; принимает объект пользователя целиком (как отправляет интерфейс)', async () => {
      const full = { ...ctx.users.client, name: 'Переименован', isBlocked: false };
      const r = await h.api('PUT', `/api/users/${ctx.users.client.id}`, { token: admin, body: full });
      assert.equal(r.status, 200);
      assert.equal(r.body.user.name, 'Переименован');
    });
    it('отклоняет неверную роль, дублирующий email, некорректный id; 404 для неизвестного', async () => {
      const id = ctx.users.client.id;
      assert.equal((await h.api('PUT', `/api/users/${id}`, { token: admin, body: { role: 'guest' } })).status, 400);
      assert.equal((await h.api('PUT', `/api/users/${id}`, { token: admin, body: { email: 'chef@test.local' } })).status, 409);
      assert.equal((await h.api('PUT', '/api/users/not-a-uuid', { token: admin, body: { name: 'x' } })).status, 400);
      assert.equal((await h.api('PUT', '/api/users/3f2b6c9e-8a1d-4c55-9a7e-1b2c3d4e5f60', { token: admin, body: { name: 'x' } })).status, 404);
    });
    it('администратор не может понизить или заблокировать самого себя', async () => {
      const id = ctx.users.admin.id;
      assert.equal((await h.api('PUT', `/api/users/${id}`, { token: admin, body: { role: 'client' } })).status, 400);
      assert.equal((await h.api('PUT', `/api/users/${id}`, { token: admin, body: { isBlocked: true } })).status, 400);
      assert.equal((await h.db('users').where({ id }).first()).role, 'admin');
    });
  });

  describe('блокировка', () => {
    it('блокирует пользователя; вход и существующие токены перестают работать', async () => {
      const session = await h.login(h.USERS.client.email);
      assert.equal((await h.api('GET', '/api/auth/me', { token: session.accessToken })).status, 200);

      const r = await h.api('DELETE', `/api/users/${ctx.users.client.id}`, { token: admin });
      assert.equal(r.status, 200);

      assert.equal((await h.api('POST', '/api/auth/login', { body: { email: h.USERS.client.email, password: h.PASSWORD } })).status, 403);
      assert.equal((await h.api('GET', '/api/auth/me', { token: session.accessToken })).status, 403);
    });
    it('отзывает refresh-токены заблокированного пользователя', async () => {
      const session = await h.login(h.USERS.client.email);
      await h.api('DELETE', `/api/users/${ctx.users.client.id}`, { token: admin });
      const active = await h.db('refresh_tokens').where({ user_id: ctx.users.client.id }).whereNull('revoked_at');
      assert.equal(active.length, 0);
      assert.equal((await h.api('POST', '/api/auth/refresh', { body: { refreshToken: session.refreshToken } })).status, 401);
    });
    it('блокировка через PUT isBlocked=true тоже отзывает токены; разблокировка возвращает доступ', async () => {
      const session = await h.login(h.USERS.waiter.email);
      await h.api('PUT', `/api/users/${ctx.users.waiter.id}`, { token: admin, body: { isBlocked: true } });
      assert.equal((await h.api('POST', '/api/auth/refresh', { body: { refreshToken: session.refreshToken } })).status, 401);
      await h.api('PUT', `/api/users/${ctx.users.waiter.id}`, { token: admin, body: { isBlocked: false } });
      assert.equal((await h.api('POST', '/api/auth/login', { body: { email: h.USERS.waiter.email, password: h.PASSWORD } })).status, 200);
    });
    it('нельзя заблокировать самого себя', async () => {
      const r = await h.api('DELETE', `/api/users/${ctx.users.admin.id}`, { token: admin });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /самого себя/);
      assert.equal((await h.db('users').where({ id: ctx.users.admin.id }).first()).is_blocked, false);
    });
    it('блокировать может только администратор', async () => {
      assert.equal((await h.api('DELETE', `/api/users/${ctx.users.client.id}`, { token: await h.tokenFor('waiter') })).status, 403);
    });
    it('несуществующий пользователь: 404', async () => {
      assert.equal((await h.api('DELETE', '/api/users/3f2b6c9e-8a1d-4c55-9a7e-1b2c3d4e5f60', { token: admin })).status, 404);
    });
  });
});
