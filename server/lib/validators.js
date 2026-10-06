'use strict';

const { validateBookingSlot } = require('./timeSlots');
const { resolveBookingDate } = require('./dates');
const { isValidRole } = require('./roles');

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/** @returns {string|null} текст ошибки или null */
function validateEmail(email) {
  if (!email) return 'Email обязателен';
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) return 'Некорректный email';
  return null;
}

function validatePassword(password) {
  if (!password) return 'Пароль обязателен';
  if (typeof password !== 'string') return 'Некорректный пароль';
  if (password.length < 6) return 'Пароль должен состоять минимум из 6 символов';
  if (password.length > 72) return 'Пароль не должен превышать 72 символа'; // ограничение bcrypt
  return null;
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'Имя обязательно';
  if (name.trim().length > 100) return 'Имя не должно превышать 100 символов';
  return null;
}

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Положительное целое из строки/числа или null. */
function toPositiveInt(value, max = 2147483647) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

const MENU_TEXT_FIELDS = {
  name: { max: 120, required: true },
  category: { max: 50, required: true },
  weight: { max: 30, required: true },
  description: { max: 1000 },
  recipe: { max: 5000 },
  cookingTime: { max: 50 },
  ingredients: { max: 1000 },
};
const MENU_REQUIRED_MSG = 'Название, цена, категория и вес блюда обязательны';
const IMAGE_RE = /^(\/|https?:\/\/)\S+$/;

/**
 * Проверка полей блюда. Неизвестные поля отбрасываются (защита от mass assignment).
 * @param {object} body
 * @param {{partial?:boolean}} opts partial=true для PUT: проверяются только переданные поля
 * @returns {{value:object}|{error:string}}
 */
function validateMenuInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Тело запроса должно быть объектом' };
  const value = {};

  for (const [key, rule] of Object.entries(MENU_TEXT_FIELDS)) {
    const raw = body[key];
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (rule.required && (!partial || raw !== undefined)) return { error: MENU_REQUIRED_MSG };
      if (partial && raw !== undefined && raw !== null) value[key] = '';
      continue;
    }
    if (typeof raw !== 'string') return { error: `Поле ${key} должно быть строкой` };
    const trimmed = raw.trim();
    if (trimmed.length > rule.max) return { error: `Поле ${key} не должно превышать ${rule.max} символов` };
    value[key] = trimmed;
  }

  if (body.price !== undefined && body.price !== null && body.price !== '') {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) return { error: 'Цена должна быть числом больше нуля' };
    value.price = Math.round(price * 100) / 100;
  } else if (!partial) {
    return { error: MENU_REQUIRED_MSG };
  }

  if (typeof body.image === 'string' && body.image.trim() !== '') {
    const image = body.image.trim();
    if (image.length > 300 || !IMAGE_RE.test(image)) return { error: 'Некорректный путь к изображению' };
    value.image = image;
  }
  return { value };
}

/** Входные данные бронирования: { timeSlot, date? }. */
function validateBookingInput(body, today) {
  const slotResult = validateBookingSlot(body && body.timeSlot);
  if (!body || !body.timeSlot) return { error: 'Время бронирования обязательно' };
  if (!slotResult.ok) return { error: slotResult.error };
  const dateResult = resolveBookingDate(body.date, today);
  if (dateResult.error) return { error: dateResult.error };
  return { value: { slot: slotResult.slot, date: dateResult.date } };
}

const MAX_DISH_LINES = 50;
const MAX_QUANTITY = 99;

/** Входные данные заказа. Название и цену блюда клиент НЕ задаёт: они берутся из меню. */
function validateOrderInput(body, today) {
  if (!body || typeof body !== 'object') return { error: 'Необходимо указать стол, время и блюда' };
  const tableId = toPositiveInt(body.tableId, 100000);
  if (!tableId || !body.timeSlot || !Array.isArray(body.dishes) || body.dishes.length === 0) {
    return { error: 'Необходимо указать стол, время и блюда' };
  }
  const slotResult = validateBookingSlot(body.timeSlot);
  if (!slotResult.ok) return { error: slotResult.error };
  const dateResult = resolveBookingDate(body.date, today);
  if (dateResult.error) return { error: dateResult.error };
  if (body.dishes.length > MAX_DISH_LINES) return { error: `В заказе не более ${MAX_DISH_LINES} позиций` };

  const dishes = [];
  for (const line of body.dishes) {
    const dishId = toPositiveInt(line && line.dishId);
    const quantity = toPositiveInt(line && line.quantity, MAX_QUANTITY);
    if (!dishId) return { error: 'Некорректный идентификатор блюда' };
    if (!quantity) return { error: `Количество должно быть целым числом от 1 до ${MAX_QUANTITY}` };
    const comment = line.comment === undefined || line.comment === null ? '' : line.comment;
    if (typeof comment !== 'string' || comment.length > 300) return { error: 'Комментарий не должен превышать 300 символов' };
    dishes.push({ dishId, quantity, comment: comment.trim() });
  }

  let clientName = null;
  if (body.clientName !== undefined && body.clientName !== null && body.clientName !== '') {
    if (typeof body.clientName !== 'string' || body.clientName.trim().length > 100) {
      return { error: 'Имя клиента не должно превышать 100 символов' };
    }
    clientName = body.clientName.trim();
  }

  return {
    value: { tableId, slot: slotResult.slot, date: dateResult.date, dishes, clientName, book: body.book === true },
  };
}

module.exports = {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateName,
  isUuid,
  isValidRole,
  toPositiveInt,
  validateMenuInput,
  validateBookingInput,
  validateOrderInput,
  MAX_QUANTITY,
};
