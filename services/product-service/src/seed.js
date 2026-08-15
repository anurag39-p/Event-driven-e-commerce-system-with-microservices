require('dotenv').config();
const { connectMongo, mongoose } = require('./db');
const Product = require('./Product');

const sampleProducts = [
  { name: 'Pulse X12 Smartphone', description: '6.5" AMOLED display, 128GB storage', price: 24999, stock: 40, category: 'phones', imageUrl: '/images/categories/phones.svg' },
  { name: 'Nova Lite 5G', description: 'Budget 5G phone with 5000mAh battery', price: 14999, stock: 60, category: 'phones', imageUrl: '/images/categories/phones.svg' },
  { name: 'Zenith Pro Max', description: 'Flagship camera phone, 256GB storage', price: 59999, stock: 20, category: 'phones', imageUrl: '/images/categories/phones.svg' },

  { name: 'AeroBook 14', description: 'Ultra-light laptop, 16GB RAM, 512GB SSD', price: 64999, stock: 25, category: 'laptops', imageUrl: '/images/categories/laptops.svg' },
  { name: 'WorkStation Pro 15', description: 'High-performance laptop for creators', price: 99999, stock: 15, category: 'laptops', imageUrl: '/images/categories/laptops.svg' },
  { name: 'EduBook Basic', description: 'Reliable everyday laptop for students', price: 32999, stock: 50, category: 'laptops', imageUrl: '/images/categories/laptops.svg' },

  { name: 'BassWave Pro Headphones', description: 'Over-ear ANC wireless headphones', price: 7999, stock: 70, category: 'audio', imageUrl: '/images/categories/audio.svg' },
  { name: 'TrueBuds Air', description: 'True wireless earbuds with charging case', price: 3499, stock: 100, category: 'audio', imageUrl: '/images/categories/audio.svg' },
  { name: 'StageSound Speaker', description: 'Portable Bluetooth speaker, 12hr battery', price: 4999, stock: 45, category: 'audio', imageUrl: '/images/categories/audio.svg' },

  { name: 'StrikePad Wireless Controller', description: 'Ergonomic wireless gaming controller', price: 3999, stock: 55, category: 'gaming', imageUrl: '/images/categories/gaming.svg' },
  { name: 'FrostKey Mechanical Keyboard', description: 'RGB backlit mechanical gaming keyboard', price: 5999, stock: 35, category: 'gaming', imageUrl: '/images/categories/gaming.svg' },
  { name: 'VortexGrip Gaming Mouse', description: 'High-DPI gaming mouse with programmable buttons', price: 2999, stock: 65, category: 'gaming', imageUrl: '/images/categories/gaming.svg' },

  { name: 'PowerLink USB-C Hub', description: '7-in-1 USB-C hub with HDMI', price: 2499, stock: 80, category: 'accessories', imageUrl: '/images/categories/accessories.svg' },
  { name: 'FlexArm Laptop Stand', description: 'Adjustable aluminum laptop stand', price: 1999, stock: 90, category: 'accessories', imageUrl: '/images/categories/accessories.svg' },
  { name: 'RapidCharge 65W Adapter', description: 'Fast-charging USB-C power adapter', price: 1499, stock: 100, category: 'accessories', imageUrl: '/images/categories/accessories.svg' },

  { name: 'SlateBook 11" Tablet', description: '11" tablet with stylus support, 128GB', price: 27999, stock: 30, category: 'tablets', imageUrl: '/images/categories/tablets.svg' },
  { name: 'MiniPad 8" Tablet', description: 'Compact 8" tablet, perfect for reading', price: 12999, stock: 45, category: 'tablets', imageUrl: '/images/categories/tablets.svg' },
  { name: 'ProSlate 12.9" Tablet', description: 'Large display tablet for creative work', price: 54999, stock: 15, category: 'tablets', imageUrl: '/images/categories/tablets.svg' },
];

async function seed() {
  await connectMongo();

  const existingCount = await Product.countDocuments();
  if (existingCount > 0) {
    console.log(`[seed] ${existingCount} products already exist. Skipping seed to avoid duplicates.`);
    console.log('[seed] To re-seed from scratch, clear the collection first.');
    await mongoose.disconnect();
    return;
  }

  const inserted = await Product.insertMany(sampleProducts);
  console.log(`[seed] Inserted ${inserted.length} sample products across 6 categories.`);
  await mongoose.disconnect();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err.message);
    process.exit(1);
  });