'use strict';

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function createRateLimit({ windowMs = 60_000, max = 60, label = 'request' } = {}) {
  const clients = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = clientKey(req);
    let entry = clients.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    clients.set(key, entry);

    if (clients.size > 10_000) {
      for (const [storedKey, stored] of clients) {
        if (stored.resetAt <= now) clients.delete(storedKey);
      }
    }

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ ok: false, error: `${label} rate limit exceeded` });
    }
    next();
  };
}

function createConcurrencyLimit({ maxGlobal = 50, maxPerClient = 6, label = 'request' } = {}) {
  let globalCount = 0;
  const clients = new Map();
  return function concurrencyLimit(req, res, next) {
    const key = clientKey(req);
    const clientCount = clients.get(key) || 0;
    if (globalCount >= maxGlobal || clientCount >= maxPerClient) {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({ ok: false, error: `${label} concurrency limit reached` });
    }

    globalCount += 1;
    clients.set(key, clientCount + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      globalCount = Math.max(0, globalCount - 1);
      const remaining = Math.max(0, (clients.get(key) || 1) - 1);
      if (remaining) clients.set(key, remaining);
      else clients.delete(key);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

module.exports = { clientKey, createConcurrencyLimit, createRateLimit };
