import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calculateTotal } from '../../src/utils/orderTotal.mjs'
import { validateBookingSlot, parseTimeSlot, slotsOverlap, formatSlot } from '../../src/utils/timeSlot.mjs'

const menu = [
  { id: 1, price: 320 },
  { id: 2, price: 550 },
  { id: 3, price: 19.99 },
]

describe('calculateTotal (фронтенд)', () => {
  it('суммирует цена × количество по id блюда', () => {
    assert.equal(calculateTotal({ 1: 2, 2: 1 }, menu), 1190)
  })
  it('пустая корзина = 0', () => {
    assert.equal(calculateTotal({}, menu), 0)
  })
  it('блюдо, которого нет в меню, не обнуляет остальную сумму (регрессия)', () => {
    assert.equal(calculateTotal({ 1: 2, 999: 3, 2: 1 }, menu), 1190)
  })
  it('не копит ошибку округления', () => {
    assert.equal(calculateTotal({ 3: 3 }, menu), 59.97)
  })
  it('не зависит от порядка блюд в меню (ключ - id, а не индекс)', () => {
    assert.equal(calculateTotal({ 2: 1 }, [...menu].reverse()), 550)
  })
})

describe('validateBookingSlot (фронтенд)', () => {
  it('принимает корректное время', () => {
    assert.equal(validateBookingSlot('15:00-17:00').ok, true)
  })
  it('сообщает об ошибках формата, длительности и рабочего времени', () => {
    assert.match(validateBookingSlot('15:0').error, /формат/i)
    assert.match(validateBookingSlot('15:00-15:20').error, /30 минут/)
    assert.match(validateBookingSlot('08:00-10:00').error, /9:00 до 23:00/)
    assert.match(validateBookingSlot('17:00-15:00').error, /позже/)
  })
  it('parseTimeSlot, slotsOverlap и formatSlot согласованы', () => {
    const a = parseTimeSlot('10:00–11:00')
    const b = parseTimeSlot('11:00-12:00')
    assert.equal(slotsOverlap(a, b), false)
    assert.equal(slotsOverlap(a, parseTimeSlot('10:30-11:30')), true)
    assert.equal(formatSlot(a), '10:00-11:00')
  })
})
