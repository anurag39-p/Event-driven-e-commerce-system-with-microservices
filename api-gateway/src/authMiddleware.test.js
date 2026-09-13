jest.mock('jsonwebtoken');
const jwt = require('jsonwebtoken');
const { isPublicPath, verifyJWT } = require('./index');

function buildReq({ path, method = 'GET', authHeader } = {}) {
  return {
    path,
    method,
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('isPublicPath', () => {
  test('treats any path ending in /health as public', () => {
    expect(isPublicPath(buildReq({ path: '/health' }))).toBe(true);
    expect(isPublicPath(buildReq({ path: '/users/health' }))).toBe(true);
  });

  test('treats /users/register and /users/login as public', () => {
    expect(isPublicPath(buildReq({ path: '/users/register' }))).toBe(true);
    expect(isPublicPath(buildReq({ path: '/users/login' }))).toBe(true);
  });

  test('treats GET /products (and subpaths) as public, but not other methods on the same path', () => {
    expect(isPublicPath(buildReq({ path: '/products', method: 'GET' }))).toBe(true);
    expect(isPublicPath(buildReq({ path: '/products/123', method: 'GET' }))).toBe(true);
    expect(isPublicPath(buildReq({ path: '/products', method: 'POST' }))).toBe(false);
    expect(isPublicPath(buildReq({ path: '/products/123', method: 'PATCH' }))).toBe(false);
  });

  test('treats everything else as protected, including other /users paths', () => {
    expect(isPublicPath(buildReq({ path: '/orders' }))).toBe(false);
    expect(isPublicPath(buildReq({ path: '/users/me' }))).toBe(false);
    expect(isPublicPath(buildReq({ path: '/payments' }))).toBe(false);
  });
});

describe('verifyJWT', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lets public paths through without checking for a token at all', () => {
    const req = buildReq({ path: '/products', method: 'GET' });
    const res = buildRes();
    const next = jest.fn();

    verifyJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects a protected path with no Authorization header', () => {
    const req = buildReq({ path: '/orders' });
    const res = buildRes();
    const next = jest.fn();

    verifyJWT(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Missing or malformed') }));
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a protected path with a malformed header (missing "Bearer " prefix)', () => {
    const req = buildReq({ path: '/orders', authHeader: 'sometoken' });
    const res = buildRes();
    const next = jest.fn();

    verifyJWT(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('on a valid token, attaches x-user-id and x-user-email headers and calls next', () => {
    jwt.verify.mockReturnValueOnce({ sub: 42, email: 'a@b.com' });
    const req = buildReq({ path: '/orders', authHeader: 'Bearer valid.token.here' });
    const res = buildRes();
    const next = jest.fn();

    verifyJWT(req, res, next);

    expect(req.headers['x-user-id']).toBe('42');
    expect(req.headers['x-user-email']).toBe('a@b.com');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects an invalid or expired token, without calling next', () => {
    jwt.verify.mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });
    const req = buildReq({ path: '/orders', authHeader: 'Bearer expired.token' });
    const res = buildRes();
    const next = jest.fn();

    verifyJWT(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Invalid or expired') }));
    expect(next).not.toHaveBeenCalled();
  });
});