'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, ALL_ROLES, isValidRole, hasRole, isStaff } = require('../../server/lib/roles');
const { checkUserChange } = require('../../server/lib/userRules');
const { isValidDateString, todayInTz, addDays, resolveBookingDate } = require('../../server/lib/dates');

describe('роли и права', () => {
  it('поддерживает ровно четыре роли', () => {
    assert.deepEqual([...ALL_ROLES].sort(), ['admin', 'chef', 'client', 'waiter']);
  });
  it('isValidRole отклоняет guest и мусор', () => {
    assert.equal(isValidRole('chef'), true);
    assert.equal(isValidRole('guest'), false);
    assert.equal(isValidRole(undefined), false);
  });
  it('hasRole и isStaff', () => {
    assert.equal(hasRole({ role: ROLES.CHEF }, ROLES.CHEF, ROLES.ADMIN), true);
    assert.equal(hasRole({ role: ROLES.CLIENT }, ROLES.CHEF, ROLES.ADMIN), false);
    assert.equal(hasRole(null, ROLES.ADMIN), false);
    assert.equal(isStaff({ role: ROLES.WAITER }), true);
    assert.equal(isStaff({ role: ROLES.CLIENT }), false);
  });
});

describe('checkUserChange', () => {
  const admin = { id: 'a1', role: 'admin', isBlocked: false };
  const waiter = { id: 'w1', role: 'waiter', isBlocked: false };

  it('разрешает менять роль другого пользователя', () => {
    assert.equal(checkUserChange({ actor: admin, target: waiter, changes: { role: 'chef' }, otherActiveAdmins: 0 }), null);
  });
  it('запрещает блокировать и менять роль самому себе', () => {
    assert.ok(checkUserChange({ actor: admin, target: admin, changes: { isBlocked: true }, otherActiveAdmins: 1 }));
    assert.ok(checkUserChange({ actor: admin, target: admin, changes: { role: 'client' }, otherActiveAdmins: 1 }));
  });
  it('не считает изменением те же значения', () => {
    assert.equal(checkUserChange({ actor: admin, target: admin, changes: { role: 'admin', isBlocked: false }, otherActiveAdmins: 0 }), null);
  });
  it('защищает последнего администратора', () => {
    const other = { id: 'a2', role: 'admin', isBlocked: false };
    assert.match(checkUserChange({ actor: admin, target: other, changes: { isBlocked: true }, otherActiveAdmins: 0 }), /последнего/);
    assert.equal(checkUserChange({ actor: admin, target: other, changes: { isBlocked: true }, otherActiveAdmins: 1 }), null);
  });
});

describe('даты', () => {
  it('isValidDateString проверяет реальный календарь', () => {
    assert.equal(isValidDateString('2026-02-28'), true);
    assert.equal(isValidDateString('2028-02-29'), true);
    assert.equal(isValidDateString('2026-02-29'), false);
    assert.equal(isValidDateString('2026-13-01'), false);
    assert.equal(isValidDateString('05.10.2026'), false);
  });
  it('addDays переходит через границы месяца и года', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
  it('todayInTz учитывает часовой пояс', () => {
    const instant = new Date('2026-10-05T22:30:00Z');
    assert.equal(todayInTz('UTC', instant), '2026-10-05');
    assert.equal(todayInTz('Europe/Moscow', instant), '2026-10-06');
  });
  it('resolveBookingDate: сегодня по умолчанию, прошлое и далёкое будущее запрещены', () => {
    assert.deepEqual(resolveBookingDate(undefined, '2026-10-05'), { date: '2026-10-05' });
    assert.deepEqual(resolveBookingDate('2026-10-05', '2026-10-05'), { date: '2026-10-05' });
    assert.ok(resolveBookingDate('2026-10-04', '2026-10-05').error);
    assert.ok(resolveBookingDate('2027-06-01', '2026-10-05').error);
    assert.ok(resolveBookingDate('завтра', '2026-10-05').error);
  });
});
