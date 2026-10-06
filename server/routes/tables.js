'use strict';

const express = require('express');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { badRequest } = require('../lib/errors');
const { toPositiveInt, validateBookingInput } = require('../lib/validators');
const { todayInTz, resolveBookingDate } = require('../lib/dates');
const { formatSlot } = require('../lib/timeSlots');
const bookings = require('../services/bookings');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { date, error } = resolveBookingDateForView(req.query.date);
  if (error) throw badRequest(error);
  res.json(await bookings.listTables(date));
});

// Для просмотра допустима и сегодняшняя дата, и будущая; прошедшие даты бронировать нельзя
function resolveBookingDateForView(input) {
  return resolveBookingDate(input, todayInTz(config.restaurantTz));
}

router.post('/:id/book', async (req, res) => {
  const tableId = toPositiveInt(req.params.id, 100000);
  if (!tableId) throw badRequest('Некорректный номер стола');
  const { value, error } = validateBookingInput(req.body, todayInTz(config.restaurantTz));
  if (error) throw badRequest(error);

  const { booking, table } = await bookings.createBooking({ tableId, userId: req.user.id, ...value });
  res.status(201).json({
    message: 'Стол успешно забронирован',
    booking: { id: booking.id, tableId, date: value.date, timeSlot: formatSlot(value.slot.start, value.slot.end) },
    table,
    bookedSlot: formatSlot(value.slot.start, value.slot.end),
  });
});

module.exports = router;
