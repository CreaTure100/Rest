'use strict';

const ROLES = Object.freeze({
  CLIENT: 'client',
  WAITER: 'waiter',
  CHEF: 'chef',
  ADMIN: 'admin',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));
const STAFF_ROLES = Object.freeze([ROLES.WAITER, ROLES.CHEF, ROLES.ADMIN]);

const isValidRole = (role) => ALL_ROLES.includes(role);
const hasRole = (user, ...roles) => Boolean(user) && roles.includes(user.role);
const isStaff = (user) => Boolean(user) && STAFF_ROLES.includes(user.role);

module.exports = { ROLES, ALL_ROLES, STAFF_ROLES, isValidRole, hasRole, isStaff };
