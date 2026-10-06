'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  if (config.logRequests) app.use(requestLogger); // раньше логгер стоял после маршрутов и ничего не писал

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      // Запросы без Origin (curl, server-to-server, тот же домен) разрешены; остальные - только из белого списка
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  const imagesDir = path.join(__dirname, '..', 'public', 'images');
  if (fs.existsSync(imagesDir)) app.use('/images', express.static(imagesDir));

  app.use('/api', routes);
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
