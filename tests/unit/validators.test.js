'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateName,
  isUuid,
  toPositiveInt,
  validateMenuInput,
  validateBookingInput,
  validateOrderInput,
} = require('../../server/lib/validators');

const TODAY = '2026-10-05';

describe('email', () => {
  it('принимает корректные адреса', () => {
    for (const e of ['a@b.co', 'user.name+tag@mail.example.com']) assert.equal(validateEmail(e), null);
  });
  it('отклоняет пустой и некорректные', () => {
    assert.match(validateEmail(''), /обязателен/);
    for (const e of ['abc', 'a@b', '@b.com', 'a b@c.com', 'a@@b.com']) assert.match(validateEmail(e), /Некорректный/);
  });
  it('нормализует регистр и пробелы', () => {
    assert.equal(normalizeEmail('  Admin@Restaurant.COM '), 'admin@restaurant.com');
    assert.equal(normalizeEmail(undefined), '');
  });
});

describe('пароль', () => {
  it('минимум 6 символов', () => {
    assert.equal(validatePassword('123456'), null);
    assert.match(validatePassword('12345'), /минимум из 6 символов/);
  });
  it('максимум 72 символа (ограничение bcrypt)', () => {
    assert.equal(validatePassword('a'.repeat(72)), null);
    assert.match(validatePassword('a'.repeat(73)), /72/);
  });
  it('обязателен и должен быть строкой', () => {
    assert.match(validatePassword(''), /обязателен/);
    assert.match(validatePassword(123456), /Некорректный/);
  });
});

describe('вспомогательные проверки', () => {
  it('validateName', () => {
    assert.equal(validateName('Иван'), null);
    assert.ok(validateName('   '));
    assert.ok(validateName('x'.repeat(101)));
  });
  it('isUuid', () => {
    assert.equal(isUuid('3f2b6c9e-8a1d-4c55-9a7e-1b2c3d4e5f60'), true);
    assert.equal(isUuid('not-a-uuid'), false);
  });
  it('toPositiveInt', () => {
    assert.equal(toPositiveInt('5'), 5);
    assert.equal(toPositiveInt(7), 7);
    for (const bad of [0, -1, 1.5, 'abc', '', null, undefined, 100]) assert.equal(toPositiveInt(bad, 99), null);
  });
});

describe('validateMenuInput', () => {
  const full = { name: ' Тирамису ', price: '380', category: 'Десерты', weight: '150г' };

  it('создание: приводит типы и обрезает пробелы', () => {
    const { value } = validateMenuInput(full);
    assert.equal(value.name, 'Тирамису');
    assert.equal(value.price, 380);
  });
  it('создание: требует название, цену, категорию и вес', () => {
    for (const key of ['name', 'price', 'category', 'weight']) {
      const body = { ...full };
      delete body[key];
      assert.match(validateMenuInput(body).error, /обязательны/, key);
    }
  });
  it('цена должна быть положительным числом', () => {
    for (const price of [0, -5, 'abc', Infinity, 1e9]) assert.ok(validateMenuInput({ ...full, price }).error, String(price));
  });
  it('отбрасывает неизвестные поля', () => {
    const { value } = validateMenuInput({ ...full, id: 999, isAdmin: true });
    assert.equal('id' in value, false);
    assert.equal('isAdmin' in value, false);
  });
  it('частичное обновление принимает только переданные поля', () => {
    assert.deepEqual(validateMenuInput({ price: 500 }, { partial: true }).value, { price: 500 });
  });
  it('частичное обновление не позволяет обнулить название', () => {
    assert.ok(validateMenuInput({ name: '  ' }, { partial: true }).error);
  });
  it('проверяет формат изображения', () => {
    assert.ok(validateMenuInput({ ...full, image: 'javascript:alert(1)' }).error);
    assert.equal(validateMenuInput({ ...full, image: '/images/a.webp' }).value.image, '/images/a.webp');
  });
});

describe('validateBookingInput', () => {
  it('принимает корректное время; дата по умолчанию сегодня', () => {
    const { value } = validateBookingInput({ timeSlot: '18:00-19:00' }, TODAY);
    assert.deepEqual(value, { slot: { start: 1080, end: 1140 }, date: TODAY });
  });
  it('требует время', () => {
    assert.match(validateBookingInput({}, TODAY).error, /обязательно/);
  });
  it('возвращает ошибки интервала и даты', () => {
    assert.match(validateBookingInput({ timeSlot: '08:00-09:00' }, TODAY).error, /9:00 до 23:00/);
    assert.match(validateBookingInput({ timeSlot: '10:00-11:00', date: '2026-10-04' }, TODAY).error, /прошедшую/);
    assert.match(validateBookingInput({ timeSlot: '10:00-11:00', date: '2026-02-30' }, TODAY).error, /дата/i);
    assert.match(validateBookingInput({ timeSlot: '10:00-11:00', date: '2027-12-31' }, TODAY).error, /90 дней/);
  });
});

describe('validateOrderInput', () => {
  const ok = { tableId: 3, timeSlot: '12:00-13:00', dishes: [{ dishId: 1, quantity: 2, comment: ' без лука ' }] };

  it('принимает корректный заказ и очищает комментарий', () => {
    const { value } = validateOrderInput(ok, TODAY);
    assert.equal(value.tableId, 3);
    assert.deepEqual(value.dishes, [{ dishId: 1, quantity: 2, comment: 'без лука' }]);
    assert.equal(value.book, false);
    assert.equal(value.date, TODAY);
  });
  it('не доверяет названию и цене из запроса', () => {
    const { value } = validateOrderInput({ ...ok, dishes: [{ dishId: 1, quantity: 1, name: 'Чужое', price: 1 }] }, TODAY);
    assert.deepEqual(Object.keys(value.dishes[0]).sort(), ['comment', 'dishId', 'quantity']);
  });
  it('требует стол, время и непустой список блюд', () => {
    assert.ok(validateOrderInput({ ...ok, dishes: [] }, TODAY).error);
    assert.ok(validateOrderInput({ ...ok, tableId: undefined }, TODAY).error);
    assert.ok(validateOrderInput({ ...ok, timeSlot: undefined }, TODAY).error);
    assert.ok(validateOrderInput(null, TODAY).error);
  });
  it('отклоняет некорректное количество', () => {
    for (const quantity of [0, -1, 1.5, '2x', 100]) {
      assert.match(validateOrderInput({ ...ok, dishes: [{ dishId: 1, quantity }] }, TODAY).error, /Количество/, String(quantity));
    }
  });
  it('отклоняет некорректный dishId и слишком длинный комментарий', () => {
    assert.ok(validateOrderInput({ ...ok, dishes: [{ dishId: 'x', quantity: 1 }] }, TODAY).error);
    assert.ok(validateOrderInput({ ...ok, dishes: [{ dishId: 1, quantity: 1, comment: 'a'.repeat(301) }] }, TODAY).error);
  });
  it('флаг book включается только значением true', () => {
    assert.equal(validateOrderInput({ ...ok, book: true }, TODAY).value.book, true);
    assert.equal(validateOrderInput({ ...ok, book: 'yes' }, TODAY).value.book, false);
  });
});
