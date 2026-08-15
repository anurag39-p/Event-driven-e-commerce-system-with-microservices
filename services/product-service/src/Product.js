const { mongoose } = require('./db');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  category: { type: String, default: 'uncategorized' },
  imageUrl: { type: String, default: '' },
}, {
  timestamps: true, // adds createdAt / updatedAt automatically
});

module.exports = mongoose.model('Product', productSchema);