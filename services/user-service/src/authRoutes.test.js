const request = require('supertest');
const express = require('express');

jest.mock('./db');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { router: authRoutes } = require('./authRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', authRoutes);
  return app;
}

describe('POST /register', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('creates a user with a hashed password and returns it without the hash', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'a@b.com', name: 'Ada' }] });
    bcrypt.hash.mockResolvedValueOnce('hashed-password-value');

    const res = await request(app)
      .post('/register')
      .send({ email: 'a@b.com', password: 'plaintext123', name: 'Ada' });

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: 1, email: 'a@b.com', name: 'Ada' });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(bcrypt.hash).toHaveBeenCalledWith('plaintext123', expect.any(Number));
  });

  test('rejects registration with an email that already exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await request(app)
      .post('/register')
      .send({ email: 'a@b.com', password: 'plaintext123', name: 'Ada' });

    expect(res.status).toBe(409);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  test('rejects registration with missing fields', async () => {
    const res = await request(app).post('/register').send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('POST /login', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('returns a token and user on correct credentials', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, email: 'a@b.com', name: 'Ada', password_hash: 'hashed-value' }],
    });
    bcrypt.compare.mockResolvedValueOnce(true);
    jwt.sign.mockReturnValueOnce('fake.jwt.token');

    const res = await request(app)
      .post('/login')
      .send({ email: 'a@b.com', password: 'plaintext123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('fake.jwt.token');
    expect(res.body.user).toEqual({ id: 1, email: 'a@b.com', name: 'Ada' });
    expect(bcrypt.compare).toHaveBeenCalledWith('plaintext123', 'hashed-value');
  });

  test('rejects login with a non-existent email without revealing whether the email exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/login')
      .send({ email: 'nobody@nowhere.com', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('rejects login with an incorrect password, using the same error as "email not found"', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, email: 'a@b.com', name: 'Ada', password_hash: 'hashed-value' }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/login')
      .send({ email: 'a@b.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});

describe('GET /me', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('returns the user for a valid token', async () => {
    jwt.verify.mockReturnValueOnce({ sub: 1, email: 'a@b.com' });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, email: 'a@b.com', name: 'Ada' }] });

    const res = await request(app).get('/me').set('Authorization', 'Bearer valid.token.here');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 1, email: 'a@b.com', name: 'Ada' });
  });

  test('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/me');

    expect(res.status).toBe(401);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  test('rejects an invalid or expired token', async () => {
    jwt.verify.mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });

    const res = await request(app).get('/me').set('Authorization', 'Bearer expired.token');

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});