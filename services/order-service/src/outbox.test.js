jest.mock('./reliability', () => ({ generateMessageId: jest.fn(() => 'fixed-message-id') }));

const { writeOutboxEvent, fetchUnpublished, markPublished, relayOnce } = require('./outbox');

describe('writeOutboxEvent', () => {
  test('inserts using the given client (not the shared pool) and returns the message id', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    const messageId = await writeOutboxEvent(client, {
      eventType: 'order.created',
      payload: { orderId: 1 },
    });

    expect(messageId).toBe('fixed-message-id');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO outbox_events'),
      ['order.created', JSON.stringify({ orderId: 1 }), 'fixed-message-id']
    );
  });
});

describe('fetchUnpublished / markPublished', () => {
  test('fetchUnpublished only selects rows with published_at IS NULL, oldest first', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };

    const rows = await fetchUnpublished(pool, 10);

    expect(rows).toEqual([{ id: 1 }]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/published_at IS NULL[\s\S]*ORDER BY id ASC/),
      [10]
    );
  });

  test('markPublished sets published_at for the given row id', async () => {
    const pool = { query: jest.fn().mockResolvedValue({}) };

    await markPublished(pool, 5);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE outbox_events'), [5]);
  });
});

describe('relayOnce', () => {
  test('publishes each unpublished row with its stored message_id and marks it published', async () => {
    const rows = [
      { id: 1, event_type: 'order.created', payload: { orderId: 1 }, message_id: 'mid-1' },
      { id: 2, event_type: 'order.created', payload: { orderId: 2 }, message_id: 'mid-2' },
    ];
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows }) // fetchUnpublished
        .mockResolvedValueOnce({}) // markPublished(1)
        .mockResolvedValueOnce({}), // markPublished(2)
    };
    const publishEvent = jest.fn();

    const count = await relayOnce(pool, publishEvent);

    expect(count).toBe(2);
    expect(publishEvent).toHaveBeenNthCalledWith(1, 'order.created', { orderId: 1 }, { messageId: 'mid-1' });
    expect(publishEvent).toHaveBeenNthCalledWith(2, 'order.created', { orderId: 2 }, { messageId: 'mid-2' });
  });

  test('stops the batch and leaves a row unpublished if publishing throws (e.g. channel down)', async () => {
    const rows = [
      { id: 1, event_type: 'order.created', payload: { orderId: 1 }, message_id: 'mid-1' },
      { id: 2, event_type: 'order.created', payload: { orderId: 2 }, message_id: 'mid-2' },
    ];
    const pool = { query: jest.fn().mockResolvedValueOnce({ rows }) };
    const publishEvent = jest.fn(() => {
      throw new Error('channel not ready');
    });

    await relayOnce(pool, publishEvent);

    // Only fetchUnpublished ran - no markPublished call, since publish failed immediately.
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
