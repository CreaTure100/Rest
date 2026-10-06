'use strict';

const { ROLES } = require('./roles');

/**
 * Правила изменения пользователя администратором.
 * Возвращает текст ошибки или null, если изменение допустимо.
 *
 * @param {{actor:{id:string}, target:{id:string, role:string, isBlocked:boolean},
 *          changes:{role?:string, isBlocked?:boolean}, otherActiveAdmins:number}} p
 */
function checkUserChange({ actor, target, changes, otherActiveAdmins }) {
  const roleChanges = changes.role !== undefined && changes.role !== target.role;
  const blocks = changes.isBlocked === true && !target.isBlocked;

  if (actor.id === target.id && (roleChanges || blocks)) {
    return 'Нельзя изменить свою роль или заблокировать самого себя';
  }

  const removesAdmin =
    target.role === ROLES.ADMIN && !target.isBlocked && ((roleChanges && changes.role !== ROLES.ADMIN) || blocks);
  if (removesAdmin && otherActiveAdmins === 0) {
    return 'Нельзя лишить доступа последнего администратора';
  }
  return null;
}

module.exports = { checkUserChange };
