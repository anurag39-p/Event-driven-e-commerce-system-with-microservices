jest.mock('./db');
const pool = require('./db');
const { recordEvent, getTimeline, getTimelinesForOrders } = require('./orderTimeline');

describe('recordEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('inserts a row with the given event data', async () => {
    pool.query.mockResolvedValueOnce({});

    await recordEvent(5, 'OrderCreated', 'Order Service', true, null);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO order_events'),
      [5, 'OrderCreated', 'Order Service', true, null]
    );
  });

  test('relies on the database column default for occurred_at, rather than generating a timestamp in application code', async () => {
    pool.query.mockResolvedValueOnce({});

    await recordEvent(5, 'OrderCreated', 'Order Service', true);

    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/occurred_at/);
  });

  test('does not throw if the database write fails - a broken timeline entry must never break the order flow', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB unavailable'));

    await expect(recordEvent(5, 'OrderCreated', 'Order Service', true)).resolves.toBeUndefined();
  });
});

describe('getTimeline', () => {
  beforeEach(() => jest.clearAllMocks());

  test('queries ordered by occurred_at ascending and returns exactly what the database provides', async () => {
    const fakeRows = [
      { event_name: 'OrderCreated', occurred_at: '2026-01-01T00:00:00.100Z' },
      { event_name: 'PaymentInitiated', occurred_at: '2026-01-01T00:00:00.200Z' },
    ];
    pool.query.mockResolvedValueOnce({ rows: fakeRows });

    const timeline = await getTimeline(5);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY occurred_at ASC'),
      [5]
    );
    expect(timeline).toEqual(fakeRows);
  });
});

describe('getTimelinesForOrders', () => {
  beforeEach(() => jest.clearAllMocks());

  test('groups events by order_id for batch fetching (used by the order list endpoint)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { order_id: 1, event_name: 'OrderCreated' },
        { order_id: 1, event_name: 'PaymentInitiated' },
        { order_id: 2, event_name: 'OrderCreated' },
      ],
    });

    const grouped = await getTimelinesForOrders([1, 2]);

    expect(grouped[1]).toHaveLength(2);
    expect(grouped[2]).toHaveLength(1);
  });

  test('returns an empty object without querying when given no order ids', async () => {
    const grouped = await getTimelinesForOrders([]);

    expect(grouped).toEqual({});
    expect(pool.query).not.toHaveBeenCalled();
  });
});