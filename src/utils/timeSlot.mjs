// Ранняя проверка времени брони на клиенте (окончательную проверку делает сервер).
// Правила совпадают с server/lib/timeSlots.js: 09:00-23:00, минимум 30 минут.
export const OPEN_MINUTE = 9 * 60
export const CLOSE_MINUTE = 23 * 60
export const MIN_DURATION = 30

const CLOCK_RE = /^(\d{1,2}):(\d{2})$/

function parseClock(str) {
  const m = CLOCK_RE.exec(String(str).trim())
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes
}

export function parseTimeSlot(slot) {
  if (typeof slot !== 'string') return null
  const parts = slot.trim().split(/\s*[-–—]\s*/)
  if (parts.length !== 2) return null
  const start = parseClock(parts[0])
  const end = parseClock(parts[1])
  return start === null || end === null ? null : { start, end }
}

const pad = (n) => String(n).padStart(2, '0')
export const formatSlot = ({ start, end }) =>
  `${pad(Math.floor(start / 60))}:${pad(start % 60)}-${pad(Math.floor(end / 60))}:${pad(end % 60)}`

export const slotsOverlap = (a, b) => a.start < b.end && a.end > b.start

export function validateBookingSlot(input) {
  const slot = parseTimeSlot(input)
  if (!slot) return { ok: false, error: 'Неверный формат времени. Используйте ЧЧ:ММ-ЧЧ:ММ' }
  if (slot.end <= slot.start) return { ok: false, error: 'Время окончания должно быть позже времени начала' }
  if (slot.end - slot.start < MIN_DURATION) return { ok: false, error: `Минимальное время бронирования ${MIN_DURATION} минут` }
  if (slot.start < OPEN_MINUTE || slot.end > CLOSE_MINUTE) return { ok: false, error: 'Ресторан работает с 9:00 до 23:00' }
  return { ok: true, slot }
}
