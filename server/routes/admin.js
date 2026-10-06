'use strict';

const express = require('express');
const config = require('../config');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ROLES } = require('../lib/roles');
const { todayInTz } = require('../lib/dates');
const bookings = require('../services/bookings');

const router = express.Router();
router.use(authenticate, requireRole(ROLES.ADMIN));

router.get('/stats', async (req, res) => {
  const today = todayInTz(config.restaurantTz);
  const [orderStats, revenue, users, menu, tables] = await Promise.all([
    db('orders')
      .select(db.raw(`count(*) AS total, count(*) FILTER (WHERE status = 'active') AS active, count(*) FILTER (WHERE status = 'completed') AS completed`))
      .first(),
    // выручка по ценам, зафиксированным в заказе на момент создания, а не по текущему меню
    db('order_items as i')
      .join('orders as o', 'o.id', 'i.order_id')
      .where('o.status', 'completed')
      .select(db.raw('COALESCE(SUM(i.unit_price * i.quantity), 0) AS revenue'))
      .first(),
    db('users').select(db.raw(`count(*) AS total, count(*) FILTER (WHERE NOT is_blocked) AS active`)).first(),
    db('menu_items').where({ is_active: true }).count('* as count').first(),
    bookings.listTables(today),
  ]);

  res.json({
    date: today,
    totalOrders: Number(orderStats.total),
    activeOrders: Number(orderStats.active),
    completedOrders: Number(orderStats.completed),
    totalRevenue: revenue.revenue,
    totalUsers: Number(users.total),
    activeUsers: Number(users.active),
    menuItems: Number(menu.count),
    tables: {
      total: tables.length,
      free: tables.filter((t) => t.status === 'free').length,
      partial: tables.filter((t) => t.status === 'partial').length,
      booked: tables.filter((t) => t.status === 'booked').length,
    },
  });
});

module.exports = router;
