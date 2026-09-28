const amqp = require('amqplib');
const { setupRetryTopology, createReliableHandler, generateMessageId } = require('./reliability');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq:5672';
const EXCHANGE = 'ecommerce_events';
const QUEUE = 'product-service.saga-events';
const SERVICE_NAME = 'product-service';
const RECONNECT_DELAY_MS = 3000;

let channel = null;
let topology = null;
let reconnecting = false;
let onReconnected = null; // re-runs queue binding + consumer setup after a fresh connection

// Registers a callback to run every time a connection is (re-)established -
// both the very first time and after any later reconnect.
function onConnected(fn) {
  onReconnected = fn;
}

function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  console.log(`[${SERVICE_NAME}] Will attempt to reconnect to RabbitMQ in ${RECONNECT_DELAY_MS}ms`);
  setTimeout(async () => {
    try {
      await connectRabbit(); // re-invokes onReconnected itself once connected
      reconnecting = false;
    } catch (err) {
      // connectRabbit()'s own retry loop (10 attempts, ~30s) is a one-time
      // grace period for initial startup. For recovering from a drop,
      // that's not long enough to assume the outage is permanent - keep
      // trying rather than leaving this service silently disconnected
      // forever (this is the same bug that left payment-service consuming
      // nothing for hours after a RabbitMQ restart).
      console.error(`[${SERVICE_NAME}] Reconnect attempt exhausted its retries, will try again:`, err.message);
      reconnecting = false;
      scheduleReconnect();
    }
  }, RECONNECT_DELAY_MS);
}

async function connectRabbit() {
  let retries = 10;
  while (retries > 0) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      // Without these, a dropped connection (RabbitMQ restart, network
      // blip) leaves `channel` pointing at a dead object forever - every
      // future publish/consume call fails the same way until this whole
      // process is manually restarted.
      connection.on('error', (err) => {
        console.error(`[${SERVICE_NAME}] RabbitMQ connection error:`, err.message);
      });
      connection.on('close', () => {
        console.error(`[${SERVICE_NAME}] RabbitMQ connection closed - will reconnect`);
        channel = null;
        topology = null;
        scheduleReconnect();
      });

      console.log(`[${SERVICE_NAME}] Connected to RabbitMQ`);

      // Re-run queue binding + consumer setup on every successful connect,
      // not just the first one - a fresh channel has none of the previous
      // channel's bindings or consumers.
      if (onReconnected) await onReconnected();

      return channel;
    } catch (err) {
      retries -= 1;
      console.log(`[${SERVICE_NAME}] RabbitMQ not ready yet, retrying... (${retries} left)`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (retries === 0) {
        console.error(`[${SERVICE_NAME}] Failed to connect to RabbitMQ after retries:`, err.message);
        throw err;
      }
    }
  }
}

// Throws rather than silently no-op'ing when the channel isn't ready, so a
// failed publish here can't let the reliable handler ACK the message as
// successfully processed anyway.
function publishEvent(routingKey, payload) {
  if (!channel) {
    throw new Error('Cannot publish - RabbitMQ channel not ready');
  }
  channel.publish(
    EXCHANGE,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: 'application/json', messageId: generateMessageId() }
  );
  console.log(`[${SERVICE_NAME}] Published event "${routingKey}"`, payload);
}

async function startSagaConsumer(pool, onMessage) {
  if (!channel) {
    throw new Error('Cannot start consumer - RabbitMQ channel not ready');
  }

  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, 'order.created');
  await channel.bindQueue(QUEUE, EXCHANGE, 'payment.failed');

  topology = await setupRetryTopology(channel, QUEUE);

  const reliableHandler = createReliableHandler({
    channel,
    pool,
    serviceName: SERVICE_NAME,
    queueName: QUEUE,
    retryQueue: topology.retryQueue,
    dlqQueue: topology.dlqQueue,
    handler: onMessage,
  });

  channel.consume(QUEUE, reliableHandler);
  console.log(`[${SERVICE_NAME}] Listening for saga events on queue "${QUEUE}" (retry + DLQ enabled)`);
}

function getChannel() {
  return channel;
}

function getTopology() {
  return topology;
}

module.exports = {
  connectRabbit,
  onConnected,
  publishEvent,
  startSagaConsumer,
  getChannel,
  getTopology,
  QUEUE,
};
