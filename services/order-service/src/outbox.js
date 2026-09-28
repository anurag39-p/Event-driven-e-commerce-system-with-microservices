const { generateMessageId } = require('./reliability');

// Writes an outbox row using the given client. IMPORTANT: pass the same
// client you used for the business-data INSERT/UPDATE in this request,
// inside the same BEGIN/COMMIT - that's the entire point of the pattern.
// Writing this with the shared `pool` instead of a transaction `client`
// would silently defeat the atomicity guarantee.
async function writeOutboxEvent(client, { eventType, payload }) {
  const messageId = generateMessageId();
  await client.query(
    `INSERT INTO outbox_events (event_type, payload, message_id)
     VALUES ($1, $2, $3)`,
    [eventType, JSON.stringify(payload), messageId]
  );
  return messageId;
}

async function fetchUnpublished(pool, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, event_type, payload, message_id
     FROM outbox_events
     WHERE published_at IS NULL
     ORDER BY id ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function markPublished(pool, id) {
  await pool.query('UPDATE outbox_events SET published_at = NOW() WHERE id = $1', [id]);
}

// Relays outbox rows to RabbitMQ. Reuses the message_id stored at write
// time (rather than minting a fresh one) so that if this tick crashes
// after publishing but before markPublished, the next tick republishes
// the same row under the same message_id - the receiving service's
// idempotency check (processed_events) is what makes that safe, exactly
// the same "at-least-once delivery + idempotent consumer" contract the
// rest of this system already relies on.
async function relayOnce(pool, publishEvent) {
  const rows = await fetchUnpublished(pool);
  for (const row of rows) {
    try {
      publishEvent(row.event_type, row.payload, { messageId: row.message_id });
      await markPublished(pool, row.id);
    } catch (err) {
      // Leave this row unpublished - it will be retried on the next tick.
      // Stop this batch here rather than plough through the rest out of
      // order (publishEvent failures here mean the channel is down, so
      // further rows in this batch would fail the same way anyway).
      console.error(`[order-service] Outbox relay failed to publish row ${row.id}:`, err.message);
      break;
    }
  }
  return rows.length;
}

function startOutboxRelay(pool, publishEvent, { intervalMs = 2000 } = {}) {
  const timer = setInterval(() => {
    relayOnce(pool, publishEvent).catch((err) => {
      console.error('[order-service] Outbox relay tick threw:', err.message);
    });
  }, intervalMs);

  // Also run immediately on startup so anything written just before a
  // restart doesn't sit unpublished for a full interval.
  relayOnce(pool, publishEvent).catch((err) => {
    console.error('[order-service] Outbox relay initial tick threw:', err.message);
  });

  return timer;
}

module.exports = { writeOutboxEvent, fetchUnpublished, markPublished, relayOnce, startOutboxRelay };
