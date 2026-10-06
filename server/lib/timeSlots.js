'use strict';

const OPEN_MINUTE = 9 * 60; // 09:00
const CLOSE_MINUTE = 23 * 60; // 23:00
const MIN_DURATION = 30; // минут

const CLOCK_RE = /^(\d{1,2}):(\d{2})$/;

function parseClock(str) {
  const m = CLOCK_RE.exec(String(str).trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const pad = (n) => String(n).padStart(2, '0');
const formatMinutes = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
const formatSlot = (start, end) => `${formatMinutes(start)}-${formatMinutes(end)}`;

/**
 * Разбор интервала. Понимает "15:00-17:00", тире/длинное тире и старый формат "с 15:00 до 17:00".
 * @returns {{start:number, end:number}|null} минуты от начала суток
 */
function parseTimeSlot(slot) {
  if (typeof slot !== 'string') return null;
  const text = slot.trim();
  const legacy = /^с\s+(.+?)\s+до\s+(.+)$/i.exec(text);
  const parts = legacy ? [legacy[1], legacy[2]] : text.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) return null;
  const start = parseClock(parts[0]);
  const end = parseClock(parts[1]);
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * Полная проверка интервала бронирования.
 * @returns {{ok:true, slot:{start:number,end:number}}|{ok:false, error:string}}
 */
function validateBookingSlot(input) {
  const slot = parseTimeSlot(input);
  if (!slot) return { ok: false, error: 'Неверный формат времени. Используйте HH:MM-HH:MM' };
  if (slot.end <= slot.start) return { ok: false, error: 'Время окончания должно быть позже времени начала' };
  if (slot.end - slot.start < MIN_DURATION) {
    return { ok: false, error: `Минимальное время бронирования ${MIN_DURATION} минут` };
  }
  if (slot.start < OPEN_MINUTE || slot.end > CLOSE_MINUTE) {
    return { ok: false, error: 'Ресторан работает с 9:00 до 23:00' };
  }
  return { ok: true, slot };
}

/** Пересечение полуинтервалов: 10:00-11:00 и 11:00-12:00 НЕ пересекаются. */
const slotsOverlap = (a, b) => a.start < b.end && a.end > b.start;
const findOverlap = (slot, existing) => existing.find((s) => slotsOverlap(slot, s)) || null;
const slotContains = (outer, inner) => outer.start <= inner.start && outer.end >= inner.end;

/**
 * Статус стола по занятым интервалам:
 *  free    - броней нет;
 *  partial - есть свободное окно не короче минимальной брони;
 *  booked  - свободных окон на бронь не осталось.
 */
function computeTableStatus(slots, { open = OPEN_MINUTE, close = CLOSE_MINUTE, minDuration = MIN_DURATION } = {}) {
  if (!slots.length) return 'free';
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  let cursor = open;
  for (const s of sorted) {
    if (s.start - cursor >= minDuration) return 'partial';
    cursor = Math.max(cursor, s.end);
  }
  return close - cursor >= minDuration ? 'partial' : 'booked';
}

module.exports = {
  OPEN_MINUTE,
  CLOSE_MINUTE,
  MIN_DURATION,
  parseClock,
  parseTimeSlot,
  formatMinutes,
  formatSlot,
  validateBookingSlot,
  slotsOverlap,
  findOverlap,
  slotContains,
  computeTableStatus,
};
