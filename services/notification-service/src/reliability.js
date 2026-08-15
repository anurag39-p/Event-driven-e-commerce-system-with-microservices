const { v4: uuidv4 } = require('uuid');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

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

async function isDuplicate(pool, messageId, serviceName) {
  const result = await pool.query(
    'SELECT 1 FROM processed_events WHERE message_id = $1 AND service_name = $2',
    [messageId, serviceName]
  );
  return result.rows.length > 0;
}

async function markProcessed(pool, messageId, serviceName) {
  await pool.query(
    'INSERT INTO processed_events (message_id, service_name) VALUES ($1, $2) ON CONFLICT (message_id, service_name) DO NOTHING',
    [messageId, serviceName]
  );
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
  return async function (msg) {
    if (!msg) return;

    const messageId = msg.properties.messageId || 'unknown';
    const priorRetryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;

    try {
      const alreadyProcessed = await isDuplicate(pool, messageId, serviceName);
      if (alreadyProcessed) {
        console.log(`[${serviceName}] Duplicate message ${messageId}, skipping (already processed)`);
        channel.ack(msg);
        return;
      }

      const routingKey = (msg.properties.headers && msg.properties.headers['x-original-routing-key'])
        || msg.fields.routingKey;
      const payload = JSON.parse(msg.content.toString());
      await handler(routingKey, payload);

      await markProcessed(pool, messageId, serviceName);
      channel.ack(msg);
    } catch (err) {
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
  isDuplicate,
  markProcessed,
  setupRetryTopology,
  createReliableHandler,
  getDlqStatus,
  replayDlq,
};
