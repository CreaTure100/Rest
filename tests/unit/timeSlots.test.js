'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTimeSlot,
  validateBookingSlot,
  slotsOverlap,
  findOverlap,
  computeTableStatus,
  formatSlot,
} = require('../../server/lib/timeSlots');

const S = (start, end) => ({ start, end });
const h = (hh, mm = 0) => hh * 60 + mm;

describe('parseTimeSlot', () => {
  it('разбирает обычный интервал', () => {
    assert.deepEqual(parseTimeSlot('15:00-17:30'), S(h(15), h(17, 30)));
  });
  it('понимает длинное тире (как в старых данных заказов)', () => {
    assert.deepEqual(parseTimeSlot('08:00–09:00'), S(h(8), h(9)));
  });
  it('понимает старый формат "с … до …"', () => {
    assert.deepEqual(parseTimeSlot('с 10:00 до 12:00'), S(h(10), h(12)));
  });
  it('принимает час без ведущего нуля', () => {
    assert.deepEqual(parseTimeSlot('9:00-10:00'), S(h(9), h(10)));
  });
  for (const bad of ['', 'abc', '15:00', '15:00-', '25:00-26:00', '10:61-11:00', '10:00-11:00-12:00', null, undefined, 42]) {
    it(`отклоняет некорректное значение ${JSON.stringify(bad)}`, () => {
      assert.equal(parseTimeSlot(bad), null);
    });
  }
});

describe('validateBookingSlot', () => {
  it('принимает корректный интервал внутри рабочего времени', () => {
    const r = validateBookingSlot('12:00-13:30');
    assert.equal(r.ok, true);
    assert.deepEqual(r.slot, S(h(12), h(13, 30)));
  });
  it('допускает минимальную длительность ровно 30 минут', () => {
    assert.equal(validateBookingSlot('12:00-12:30').ok, true);
  });
  it('отклоняет интервал короче 30 минут', () => {
    const r = validateBookingSlot('12:00-12:29');
    assert.equal(r.ok, false);
    assert.match(r.error, /30 минут/);
  });
  it('отклоняет конец раньше начала', () => {
    assert.equal(validateBookingSlot('15:00-14:00').ok, false);
  });
  it('допускает границы рабочего дня 09:00-23:00', () => {
    assert.equal(validateBookingSlot('09:00-23:00').ok, true);
  });
  it('отклоняет начало раньше 09:00', () => {
    const r = validateBookingSlot('08:30-10:00');
    assert.equal(r.ok, false);
    assert.match(r.error, /9:00 до 23:00/);
  });
  it('отклоняет конец позже 23:00', () => {
    assert.equal(validateBookingSlot('22:00-23:30').ok, false);
  });
  it('сообщает о неверном формате', () => {
    assert.match(validateBookingSlot('вечером').error, /формат/i);
  });
});

describe('пересечение интервалов', () => {
  it('смежные интервалы не пересекаются', () => {
    assert.equal(slotsOverlap(S(600, 660), S(660, 720)), false);
    assert.equal(slotsOverlap(S(660, 720), S(600, 660)), false);
  });
  it('частичное пересечение', () => {
    assert.equal(slotsOverlap(S(600, 700), S(660, 720)), true);
  });
  it('вложенный интервал', () => {
    assert.equal(slotsOverlap(S(600, 800), S(650, 700)), true);
  });
  it('findOverlap возвращает конфликтующий интервал или null', () => {
    const existing = [S(600, 660), S(900, 960)];
    assert.deepEqual(findOverlap(S(630, 700), existing), S(600, 660));
    assert.equal(findOverlap(S(660, 900), existing), null);
  });
});

describe('computeTableStatus', () => {
  it('free без броней', () => {
    assert.equal(computeTableStatus([]), 'free');
  });
  it('partial, если остаётся окно на бронь', () => {
    assert.equal(computeTableStatus([S(h(10), h(11))]), 'partial');
  });
  it('booked, если занят весь рабочий день', () => {
    assert.equal(computeTableStatus([S(h(9), h(23))]), 'booked');
  });
  it('booked, если оставшиеся окна короче 30 минут', () => {
    assert.equal(computeTableStatus([S(h(9), h(12)), S(h(12, 20), h(23))]), 'booked');
  });
  it('partial, если окно ровно 30 минут', () => {
    assert.equal(computeTableStatus([S(h(9), h(12)), S(h(12, 30), h(23))]), 'partial');
  });
  it('не зависит от порядка интервалов', () => {
    assert.equal(computeTableStatus([S(h(12, 30), h(23)), S(h(9), h(12))]), 'partial');
  });
  it('partial, если свободен только вечер', () => {
    assert.equal(computeTableStatus([S(h(9), h(21))]), 'partial');
  });
});

describe('formatSlot', () => {
  it('форматирует с ведущими нулями и обычным дефисом', () => {
    assert.equal(formatSlot(h(9), h(10, 5)), '09:00-10:05');
  });
});
