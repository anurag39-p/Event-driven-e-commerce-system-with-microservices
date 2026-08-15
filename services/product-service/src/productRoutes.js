const express = require('express');
const mongoose = require('mongoose');
const Product = require('./Product');

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

router.post('/', async (req, res) => {
  const { name, description, price, stock, category, imageUrl } = req.body;

  if (!name || typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'name and a non-negative numeric price are required' });
  }

  try {
    const product = await Product.create({
      name,
      description,
      price,
      stock: typeof stock === 'number' ? stock : 0,
      category,
      imageUrl,
    });
    return res.status(201).json({ product });
  } catch (err) {
    console.error('[product-service] Create error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) {
      filter.category = req.query.category;
    }
    const products = await Product.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ products, count: products.length });
  } catch (err) {
    console.error('[product-service] List error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid product id' });
  }

  try {
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    return res.status(200).json({ product });
  } catch (err) {
    console.error('[product-service] Get error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { stock, delta } = req.body;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid product id' });
  }
  if (typeof stock !== 'number' && typeof delta !== 'number') {
    return res.status(400).json({ error: 'Provide either "stock" (absolute) or "delta" (relative) as a number' });
  }

  try {
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (typeof stock === 'number') {
      if (stock < 0) return res.status(400).json({ error: 'stock cannot be negative' });
      product.stock = stock;
    } else {
      const newStock = product.stock + delta;
      if (newStock < 0) {
        return res.status(409).json({ error: 'Insufficient stock for this operation' });
      }
      product.stock = newStock;
    }

    await product.save();
    return res.status(200).json({ product });
  } catch (err) {
    console.error('[product-service] Stock update error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;