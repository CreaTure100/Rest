'use strict';

const express = require('express');
const config = require('../config');
const { authenticate, requireRole } = require('../middleware/auth');
const { badRequest, notFound, forbidden } = require('../lib/errors');
const { ROLES, isStaff } = require('../lib/roles');
const { toPositiveInt, validateOrderInput } = require('../lib/validators');
const { todayInTz, isValidDateString } = require('../lib/dates');
const orders = require('../services/orders');

const router = express.Router();
router.use(authenticate);

// Клиент видит только свои заказы, сотрудники — все (раньше список всех заказов получал любой клиент)
router.get('/', async (req, res) => {
  const { status, date } = req.query;
  if (status !== undefined && !['active', 'completed'].includes(status)) throw badRequest('Некорректный статус');
  if (date !== undefined && !isValidDateString(date)) throw badRequest('Некорректная дата');
  const limit = req.query.limit === undefined ? 200 : toPositiveInt(req.query.limit, 500);
  if (!limit) throw badRequest('limit должен быть числом от 1 до 500');

  res.json(await orders.listOrders({ userId: isStaff(req.user) ? undefined : req.user.id, status, date, limit }));
});

router.get('/my', async (req, res) => {
  res.json(await orders.listOrders({ userId: req.user.id }));
});

router.post('/', async (req, res) => {
  const { value, error } = validateOrderInput(req.body, todayInTz(config.restaurantTz));
  if (error) throw badRequest(error);
  const order = await orders.createOrder({ user: req.user, input: value });
  res.status(201).json({ message: 'Заказ создан', order });
});

router.get('/:id', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (!id) throw badRequest('Некорректный номер заказа');
  const order = await orders.getOrderById(id);
  if (!order) throw notFound('Заказ не найден');
  if (!isStaff(req.user) && order.clientId !== req.user.id) throw forbidden();
  res.json(order);
});

router.put('/:orderId/dish/:dishIndex/serve', requireRole(ROLES.WAITER, ROLES.ADMIN), async (req, res) => {
  const orderId = toPositiveInt(req.params.orderId);
  const dishIndex = /^\d+$/.test(req.params.dishIndex) ? Number(req.params.dishIndex) : null;
  if (!orderId || dishIndex === null) throw badRequest('Некорректные параметры');
  const order = await orders.serveDish(orderId, dishIndex);
  res.json({ message: 'Блюдо подано', order });
});

module.exports = router;
