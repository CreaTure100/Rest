'use strict';

const DEFAULT_TZ = 'Europe/Moscow';
const MAX_DAYS_AHEAD = 90;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Реальная календарная дата в формате YYYY-MM-DD (отсекает 2026-02-30). */
function isValidDateString(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Сегодняшняя дата в часовом поясе ресторана. */
function todayInTz(tz = DEFAULT_TZ, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Проверка даты бронирования. Пустое значение = сегодня.
 * @returns {{date:string}|{error:string}}
 */
function resolveBookingDate(input, today) {
  if (input === undefined || input === null || input === '') return { date: today };
  if (!isValidDateString(input)) return { error: 'Некорректная дата, ожидается формат YYYY-MM-DD' };
  if (input < today) return { error: 'Нельзя бронировать на прошедшую дату' };
  if (input > addDays(today, MAX_DAYS_AHEAD)) {
    return { error: `Бронирование доступно не более чем на ${MAX_DAYS_AHEAD} дней вперёд` };
  }
  return { date: input };
}

module.exports = { DEFAULT_TZ, MAX_DAYS_AHEAD, isValidDateString, todayInTz, addDays, resolveBookingDate };
