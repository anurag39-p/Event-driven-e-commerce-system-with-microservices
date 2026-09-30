const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/ecommerce_products';

async function connectMongo() {
  let retries = 10;
  while (retries > 0) {
    try {
      await mongoose.connect(MONGO_URI);
      console.log('[product-service] Connected to MongoDB');
      return;
    } catch (err) {
      retries -= 1;
      console.log(`[product-service] MongoDB not ready yet, retrying... (${retries} left)`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (retries === 0) {
        console.error('[product-service] Failed to connect to MongoDB after retries:', err.message);
        throw err;
      }
    }
  }
}

module.exports = { connectMongo, mongoose };
