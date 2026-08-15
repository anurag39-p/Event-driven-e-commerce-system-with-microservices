const { mongoose } = require('./db');

// Records what stock was reserved for a given order, so that if payment
// fails later, we know exactly what to give back - without having to
// trust whatever the payment.failed event happens to include.
const reservationSchema = new mongoose.Schema({
  orderId: { type: Number, required: true, unique: true },
  items: [{
    productId: { type: String, required: true },
    quantity: { type: Number, required: true },
  }],
  status: { type: String, enum: ['RESERVED', 'RELEASED'], default: 'RESERVED' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Reservation', reservationSchema);