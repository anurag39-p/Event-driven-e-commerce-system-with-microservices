const request = require('supertest');
const express = require('express');

jest.mock('./db');
jest.mock('./rabbit');
jest.mock('./orderTimeline');

const pool = require('./db');
const { publishEvent } = require('./rabbit');
const { recordEvent, getTimeline, getTimelinesForOrders } = require('./orderTimeline');
const orderRoutes = require('./orderRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', orderRoutes);
  return app;
}

const validItems = [{ productId: 'abc123', quantity: 2, price: 20 }];

describe('Order creation - POST /', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('creates an order with PENDING status and stores the correct items/total', async () => {
    const fakeOrderRow = {
      id: 1,
      user_id: 42,
      items: validItems,
      total: '40.00',
      status: 'PENDING',
      cancellation_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    pool.query.mockResolvedValueOnce({ rows: [fakeOrderRow] });

    const res = await request(app)
      .post('/')
      .set('x-user-id', '42')
      .send({ items: validItems });

    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('PENDING');
    expect(res.body.order.items).toEqual(validItems);
    expect(res.body.order.total).toBe('40.00');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orders'),
      [42, JSON.stringify(validItems), 40]
    );
  });

  test('records an OrderCreated timeline event', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 7, user_id: 42, items: validItems, total: '40.00', status: 'PENDING' }],
    });

    await request(app).post('/').set('x-user-id', '42').send({ items: validItems });

    expect(recordEvent).toHaveBeenCalledWith(7, 'OrderCreated', 'Order Service', true);
  });

  test('publishes order.created and records a PaymentInitiated timeline event', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 7, user_id: 42, items: validItems, total: '40.00', status: 'PENDING' }],
    });

    await request(app).post('/').set('x-user-id', '42').send({ items: validItems });

    expect(publishEvent).toHaveBeenCalledWith('order.created', expect.objectContaining({ orderId: 7 }));
    expect(recordEvent).toHaveBeenCalledWith(7, 'PaymentInitiated', 'RabbitMQ \u2192 Payment Service', true);
  });

  test('rejects a request with no resolvable user', async () => {
    const res = await request(app).post('/').send({ items: validItems });

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects an empty items array', async () => {
    const res = await request(app).post('/').set('x-user-id', '42').send({ items: [] });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('Authorization - GET /:id', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test("a user cannot access another user's order", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 5, user_id: 42, items: [], total: '10.00', status: 'CONFIRMED' }],
    });

    const res = await request(app).get('/5').set('x-user-id', '999');

    expect(res.status).toBe(404);
    expect(getTimeline).not.toHaveBeenCalled();
  });

  test("the authenticated user's identity is respected when they DO own the order", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 5, user_id: 42, items: [], total: '10.00', status: 'CONFIRMED' }],
    });
    getTimeline.mockResolvedValueOnce([]);

    const res = await request(app).get('/5').set('x-user-id', '42');

    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(5);
  });

  test('rejects requests with no resolvable user before ever touching the database', async () => {
    const res = await request(app).get('/5');

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric id', async () => {
    const res = await request(app).get('/not-a-number').set('x-user-id', '42');
    expect(res.status).toBe(400);
  });
});

describe('Authorization - GET / (list)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('only returns orders for the authenticated user, ignoring any client-supplied query param', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 42, items: [], total: '10.00', status: 'CONFIRMED' }],
    });
    getTimelinesForOrders.mockResolvedValueOnce({});

    const res = await request(app).get('/?userId=999').set('x-user-id', '42');

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [42]);
  });

  test('rejects requests with no resolvable user', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});