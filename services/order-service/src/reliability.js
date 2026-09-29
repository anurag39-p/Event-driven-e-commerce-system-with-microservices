const { v4: uuidv4 } = require('uuid');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Each in-flight message holds one DB connection for its idempotency claim
// (see createReliableHandler), and a handler may need a second connection
// from the same pool for its own queries. With pg's default pool of 10, a
// backlog delivered all at once would leave every connection held by a
// claim while every handler waits for another one - a deadlock. Capping
// in-flight messages keeps 2 * MAX_IN_FLIGHT comfortably under the pool size.
const MAX_IN_FLIGHT = parseInt(process.env.CONSUMER_PREFETCH || '4', 10);

function generateMessageId() {
  return uuidv4();
}

async function ensureIdempotencyTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_events (
      message_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, service_name)
    );
  `);
}

// Atomically claims a message for this service. Returns true if this call
// inserted the row (we own the message and should process it), false if a
// row already existed (someone processed it, or is processing it right now).
// A single INSERT ... ON CONFLICT DO NOTHING replaces the old
// SELECT-then-INSERT pair, which let two concurrent deliveries of the same
// message both pass the check. It must run inside the caller's transaction
// (see createReliableHandler) so the claim is rolled back if processing
// fails - otherwise the retry would look like a duplicate and be dropped.
async function claimEvent(client, messageId, serviceName) {
  const result = await client.query(
    `INSERT INTO processed_events (message_id, service_name)
     VALUES ($1, $2)
     ON CONFLICT (message_id, service_name) DO NOTHING`,
    [messageId, serviceName]
  );
  return result.rowCount === 1;
}

async function setupRetryTopology(channel, queueName) {
  const retryQueue = `${queueName}.retry`;
  const dlqQueue = `${queueName}.dlq`;

  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      'x-message-ttl': RETRY_DELAY_MS,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': queueName,
    },
  });

  await channel.assertQueue(dlqQueue, { durable: true });

  return { retryQueue, dlqQueue };
}

function createReliableHandler({ channel, pool, serviceName, queueName, retryQueue, dlqQueue, handler }) {
  // Applies to the consumer registered right after this handler is created.
  if (typeof channel.prefetch === 'function') {
    Promise.resolve(channel.prefetch(MAX_IN_FLIGHT)).catch((err) => {
      console.error(`[${serviceName}] Failed to set consumer prefetch:`, err.message);
    });
  }

  return async function (msg) {
    if (!msg) return;

    const messageId = msg.properties.messageId || 'unknown';
    const priorRetryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;

    // The claim, the handler, and the commit share one transaction:
    //  - handler fails or the process crashes -> the claim rolls back, so the
    //    retry / redelivery is processed normally (at-least-once preserved);
    //  - a concurrent duplicate's INSERT blocks on the unique index until this
    //    transaction ends, then either skips (we committed) or takes over (we
    //    rolled back);
    //  - we only ack after COMMIT, so a crash between the two just redelivers
    //    a message that then hits the committed claim and is skipped.
    let client;
    let discardClient = false;

    // Errors on a CHECKED-OUT client are emitted on the client itself - the
    // pool's own 'error' handler only covers idle clients. Without this
    // listener, Postgres dropping or restarting mid-message would surface as
    // an uncaught exception and crash the whole service. With it, the
    // in-flight query/COMMIT rejects normally and we fall into the retry path.
    const onClientError = (err) => {
      discardClient = true;
      console.error(`[${serviceName}] DB connection error while handling ${messageId}:`, err.message);
    };

    try {
      client = await pool.connect();
      client.on('error', onClientError);
      await client.query('BEGIN');

      const claimed = await claimEvent(client, messageId, serviceName);
      if (!claimed) {
        await client.query('ROLLBACK');
        console.log(`[${serviceName}] Duplicate message ${messageId}, skipping (already processed)`);
        channel.ack(msg);
        return;
      }

      const routingKey = (msg.properties.headers && msg.properties.headers['x-original-routing-key'])
        || msg.fields.routingKey;
      const payload = JSON.parse(msg.content.toString());
      await handler(routingKey, payload);

      await client.query('COMMIT');
      channel.ack(msg);
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          discardClient = true; // connection is unusable - destroy it instead of pooling it
        }
      }
      const nextRetryCount = priorRetryCount + 1;
      console.error(`[${serviceName}] Processing failed for message ${messageId} (attempt ${nextRetryCount}):`, err.message);

      if (nextRetryCount >= MAX_RETRIES) {
        console.error(`[${serviceName}] Max retries exceeded for ${messageId} - sending to DLQ`);
        channel.sendToQueue(dlqQueue, msg.content, {
          persistent: true,
          messageId,
          headers: {
            ...msg.properties.headers,
            'x-retry-count': nextRetryCount,
            'x-original-routing-key': msg.fields.routingKey,
            'x-last-error': err.message,
          },
        });
      } else {
        console.log(`[${serviceName}] Requeuing ${messageId} - will retry in ${RETRY_DELAY_MS}ms (attempt ${nextRetryCount + 1}/${MAX_RETRIES})`);
        channel.sendToQueue(retryQueue, msg.content, {
          persistent: true,
          messageId,
          headers: {
            ...msg.properties.headers,
            'x-retry-count': nextRetryCount,
            'x-original-routing-key': msg.fields.routingKey,
          },
        });
      }

      channel.ack(msg);
    } finally {
      if (client) {
        client.removeListener('error', onClientError);
        client.release(discardClient);
      }
    }
  };
}

async function getDlqStatus(channel, dlqQueue) {
  const info = await channel.checkQueue(dlqQueue);
  return { queue: dlqQueue, messageCount: info.messageCount };
}

async function replayDlq(channel, dlqQueue, queueName, limit = 50) {
  let replayed = 0;
  for (let i = 0; i < limit; i++) {
    const msg = await channel.get(dlqQueue, { noAck: false });
    if (!msg) break;

    channel.sendToQueue(queueName, msg.content, {
      persistent: true,
      messageId: msg.properties.messageId,
      headers: { ...msg.properties.headers, 'x-retry-count': 0 },
    });
    channel.ack(msg);
    replayed++;
  }
  return replayed;
}

module.exports = {
  generateMessageId,
  ensureIdempotencyTable,
  claimEvent,
  setupRetryTopology,
  createReliableHandler,
  getDlqStatus,
  replayDlq,
};
