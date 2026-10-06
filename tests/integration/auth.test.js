'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

describe('API: авторизация', () => {
  before(() => h.start());
  after(() => h.stop());
  beforeEach(() => h.resetData());

  describe('регистрация', () => {
    it('успешно регистрирует клиента, email нормализуется, пароль не возвращается', async () => {
      const r = await h.api('POST', '/api/auth/register', { body: { name: 'Новый', email: ' New@Example.COM ', password: 'secret1' } });
      assert.equal(r.status, 201);
      assert.equal(r.body.user.email, 'new@example.com');
      assert.equal(r.body.user.role, 'client');
      assert.equal(JSON.stringify(r.body).toLowerCase().includes('password'), false);
      const row = await h.db('users').where({ email: 'new@example.com' }).first();
      assert.notEqual(row.password_hash, 'secret1'); // хранится только хеш
      assert.match(row.password_hash, /^\$2[aby]\$/);
    });
    it('отклоняет некорректный email', async () => {
      const r = await h.api('POST', '/api/auth/register', { body: { name: 'A', email: 'not-an-email', password: 'secret1' } });
      assert.equal(r.status, 400);
    });
    it('отклоняет короткий пароль', async () => {
      const r = await h.api('POST', '/api/auth/register', { body: { name: 'A', email: 'a@b.co', password: '123' } });
      assert.equal(r.status, 400);
    });
    it('отклоняет уже существующий email (в том числе в другом регистре)', async () => {
      const r = await h.api('POST', '/api/auth/register', { body: { name: 'Дубль', email: 'CLIENT@test.local', password: 'secret1' } });
      assert.equal(r.status, 409);
    });
    it('не допускает самостоятельной регистрации с ролью admin', async () => {
      const r = await h.api('POST', '/api/auth/register', { body: { name: 'Хакер', email: 'h@x.co', password: 'secret1', role: 'admin' } });
      assert.equal(r.status, 201);
      assert.equal(r.body.user.role, 'client');
    });
  });

  describe('вход', () => {
    it('успешный вход возвращает токены и пользователя без пароля', async () => {
      const r = await h.api('POST', '/api/auth/login', { body: { email: 'CLIENT@test.local', password: h.PASSWORD } });
      assert.equal(r.status, 200);
      assert.ok(r.body.accessToken && r.body.refreshToken);
      assert.equal(r.body.user.role, 'client');
      assert.equal('password' in r.body.user, false);
    });
    it('неверный пароль и несуществующий email дают одинаковый ответ 401', async () => {
      const wrong = await h.api('POST', '/api/auth/login', { body: { email: 'client@test.local', password: 'wrong-password' } });
      const unknown = await h.api('POST', '/api/auth/login', { body: { email: 'nobody@test.local', password: 'wrong-password' } });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(wrong.body.error, unknown.body.error);
    });
    it('требует email и пароль', async () => {
      assert.equal((await h.api('POST', '/api/auth/login', { body: { email: 'client@test.local' } })).status, 400);
    });
    it('refresh-токен хранится в БД только в виде хеша', async () => {
      const { refreshToken } = await h.login(h.USERS.client.email);
      const rows = await h.db('refresh_tokens');
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].token_hash, refreshToken);
    });
  });

  describe('доступ по токену', () => {
    it('без токена: 401', async () => {
      assert.equal((await h.api('GET', '/api/auth/me')).status, 401);
    });
    it('с недействительным токеном: 401', async () => {
      assert.equal((await h.api('GET', '/api/auth/me', { token: 'abc.def.ghi' })).status, 401);
    });
    it('с действительным токеном возвращает текущего пользователя', async () => {
      const token = await h.tokenFor('chef');
      const r = await h.api('GET', '/api/auth/me', { token });
      assert.equal(r.status, 200);
      assert.equal(r.body.email, h.USERS.chef.email);
    });
    it('refresh-токен не подходит как access-токен', async () => {
      const { refreshToken } = await h.login(h.USERS.client.email);
      assert.equal((await h.api('GET', '/api/auth/me', { token: refreshToken })).status, 401);
    });
  });

  describe('обновление токена и выход', () => {
    it('refresh выдаёт новую пару, старый refresh-токен становится недействительным', async () => {
      const first = await h.login(h.USERS.client.email);
      const r = await h.api('POST', '/api/auth/refresh', { body: { refreshToken: first.refreshToken } });
      assert.equal(r.status, 200);
      assert.notEqual(r.body.refreshToken, first.refreshToken);
      assert.equal((await h.api('GET', '/api/auth/me', { token: r.body.accessToken })).status, 200);
      assert.equal((await h.api('POST', '/api/auth/refresh', { body: { refreshToken: first.refreshToken } })).status, 401);
    });
    it('refresh с мусором или без токена: 401', async () => {
      assert.equal((await h.api('POST', '/api/auth/refresh', { body: { refreshToken: 'garbage' } })).status, 401);
      assert.equal((await h.api('POST', '/api/auth/refresh', { body: {} })).status, 401);
    });
    it('выход отзывает refresh-токен', async () => {
      const t = await h.login(h.USERS.client.email);
      const out = await h.api('POST', '/api/auth/logout', { body: { refreshToken: t.refreshToken } });
      assert.equal(out.status, 200);
      assert.equal((await h.api('POST', '/api/auth/refresh', { body: { refreshToken: t.refreshToken } })).status, 401);
    });
    it('выход работает и без действующего access-токена', async () => {
      const t = await h.login(h.USERS.client.email);
      const out = await h.api('POST', '/api/auth/logout', { token: 'expired.or.garbage', body: { refreshToken: t.refreshToken } });
      assert.equal(out.status, 200);
    });
  });

  describe('обработка ошибок', () => {
    it('невалидный JSON даёт 400 и не раскрывает стек', async () => {
      const res = await fetch(h.url('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json',
      });
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.equal(/\bat .*\.js/.test(text), false);
    });
    it('неизвестный маршрут API отвечает JSON с 404', async () => {
      const r = await h.api('GET', '/api/nope');
      assert.equal(r.status, 404);
      assert.ok(r.body.error);
    });
    it('health-check проверяет подключение к БД', async () => {
      const r = await h.api('GET', '/api/health');
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'ok');
    });
  });
});
