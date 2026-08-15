const amqp = require('amqplib');
const { setupRetryTopology, createReliableHandler, generateMessageId } = require('./reliability');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq:5672';
const EXCHANGE = 'ecommerce_events';
const QUEUE = 'order-service.payment-results';
const SERVICE_NAME = 'order-service';

let channel = null;
let topology = null;

async function connectRabbit() {
  let retries = 10;
  while (retries > 0) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      console.log(`[${SERVICE_NAME}] Connected to RabbitMQ`);
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

function publishEvent(routingKey, payload) {
  if (!channel) {
    console.error(`[${SERVICE_NAME}] Cannot publish - RabbitMQ channel not ready`);
    return;
  }
  channel.publish(
    EXCHANGE,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: 'application/json', messageId: generateMessageId() }
  );
  console.log(`[${SERVICE_NAME}] Published event "${routingKey}"`, payload);
}

async function startPaymentResultConsumer(pool, onMessage) {
  if (!channel) {
    throw new Error('Cannot start consumer - RabbitMQ channel not ready');
  }

  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, 'payment.succeeded');
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
  console.log(`[${SERVICE_NAME}] Listening for payment results on queue "${QUEUE}" (retry + DLQ enabled)`);
}

function getChannel() {
  return channel;
}

function getTopology() {
  return topology;
}

module.exports = {
  connectRabbit,
  publishEvent,
  startPaymentResultConsumer,
  getChannel,
  getTopology,
  QUEUE,
};
