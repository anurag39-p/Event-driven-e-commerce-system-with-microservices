jest.mock('./db');

const pool = require('./db');
const { updateOrderStatus } = require('./orderStatus');

describe('updateOrderStatus - valid transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('PENDING -> CONFIRMED: only matches rows that are currently PENDING, returns the updated row', async () => {
    const row = { id: 5, status: 'CONFIRMED', cancellation_reason: null };
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await updateOrderStatus(5, 'CONFIRMED');

    expect(result).toEqual(row);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$3 AND status = ANY\(\$4\)/);
    expect(params).toEqual(['CONFIRMED', null, 5, ['PENDING']]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('PENDING -> CANCELLED stores the cancellation reason', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 6, status: 'CANCELLED', cancellation_reason: 'declined' }] });

    await updateOrderStatus(6, 'CANCELLED', 'declined');

    expect(pool.query.mock.calls[0][1]).toEqual(['CANCELLED', 'declined', 6, ['PENDING']]);
  });

  test('a terminal order is left untouched: returns null, does not throw, and does not retry the write', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // guarded UPDATE matched nothing
      .mockResolvedValueOnce({ rows: [{ status: 'CONFIRMED' }] }); // diagnostic lookup

    const result = await updateOrderStatus(7, 'CANCELLED', 'late failure');

    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][0]).toMatch(/SELECT status FROM orders/);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('already CONFIRMED'));
  });

  test('an unknown order returns null and is logged as an error, not a "terminal" warning', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await updateOrderStatus(999, 'CONFIRMED');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unknown order id 999'));
    expect(console.warn).not.toHaveBeenCalled();
  });

  test.each(['PENDING', 'SHIPPED', undefined])('rejects an unsupported target status (%s) without touching the database', async (status) => {
    await expect(updateOrderStatus(1, status)).rejects.toThrow(/Unsupported target status/);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
