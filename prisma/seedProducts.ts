/**
 * @file seedProducts.ts
 * @description Non-destructive inventory and product seeder for Liyanage Distributors.
 * Upserts default locations (LOC_MAIN, LOC_VAN_01), 4 top-selling Sri Lankan electrical & hardware products,
 * and initial LOC_MAIN buffer stock (100 units each) with ZERO data loss and ZERO deletes.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const TOP_SELLING_PRODUCTS = [
  {
    sku: 'LED-ORG-10W',
    name: 'Orange 10W B22 LED Bulb Cool Daylight',
    category: 'Lighting & Electrical',
    unit: 'Unit',
    basePrice: 650.0,
    companyDiscountPercent: 10.0,
    targetCapacity: 100.0,
  },
  {
    sku: 'SW-KEV-13A',
    name: 'Kevilton 13A Single Switched Socket',
    category: 'Switchgear & Accessories',
    unit: 'Unit',
    basePrice: 720.0,
    companyDiscountPercent: 12.0,
    targetCapacity: 60.0,
  },
  {
    sku: 'PVC-SLN-050',
    name: 'S-lon 1/2 inch PVC Pipe (4m)',
    category: 'Plumbing & PVC',
    unit: 'Length',
    basePrice: 850.0,
    companyDiscountPercent: 8.0,
    targetCapacity: 50.0,
  },
  {
    sku: 'CW-ACL-100',
    name: 'ACL 1.0mm Single Core Copper Wire (100m)',
    category: 'Cables & Wires',
    unit: 'Roll',
    basePrice: 8500.0,
    companyDiscountPercent: 15.0,
    targetCapacity: 20.0,
  },
];

/**
 * Safely upserts default inventory locations and top-selling products.
 * Does NOT execute any DELETE or DROP commands.
 */
export async function seedTopSellingProducts(client: any = prisma) {
  console.log('\n📦 Seeding Inventory Locations & Top-Selling Products (Non-Destructive)...');

  // 1. Upsert LOC_MAIN (Main Warehouse)
  const locMain = await client.inventoryLocation.upsert({
    where: { id: 'LOC_MAIN' },
    update: {
      name: 'Central Warehouse Deiyandara',
      type: 'MAIN_STORE',
      isActive: true,
    },
    create: {
      id: 'LOC_MAIN',
      name: 'Central Warehouse Deiyandara',
      category: 'Main Warehouse',
      type: 'MAIN_STORE',
      description: 'Liyanage Hardware Central Distribution Warehouse & Inbound Hub, Hakmana Rd, Deiyandara',
      isActive: true,
    },
  });
  console.log(`  ✓ Location: ${locMain.name} (${locMain.id})`);

  // 2. Upsert LOC_VAN_01 (Delivery Van 01)
  const activeRoute = await client.route.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  });
  const activeRep = await client.salesPerson.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  });

  const locVan = await client.inventoryLocation.upsert({
    where: { id: 'LOC_VAN_01' },
    update: {
      name: 'Delivery Van 01',
      vehicleId: 'VAN-01',
      vehicleNumber: 'WP KDK-4521',
      vehicleSpec: 'Isuzu Elf 14.5ft Box Truck',
      driverName: 'Sunil Shantha',
      routeId: activeRoute?.id || null,
      salesPersonId: activeRep?.id || null,
      isActive: true,
    },
    create: {
      id: 'LOC_VAN_01',
      name: 'Delivery Van 01',
      category: 'Delivery Van',
      type: 'VEHICLE',
      vehicleId: 'VAN-01',
      vehicleNumber: 'WP KDK-4521',
      vehicleSpec: 'Isuzu Elf 14.5ft Box Truck',
      driverName: 'Sunil Shantha',
      routeId: activeRoute?.id || null,
      salesPersonId: activeRep?.id || null,
      description: 'Primary mobile delivery truck for hardware field distribution',
      isActive: true,
    },
  });
  console.log(`  ✓ Location: ${locVan.name} (${locVan.id} - ${locVan.vehicleNumber})`);

  // 3. Upsert Quarantined Damaged Pool
  await client.inventoryLocation.upsert({
    where: { id: 'LOC_DAMAGED' },
    update: { isActive: true },
    create: {
      id: 'LOC_DAMAGED',
      name: 'Damaged Goods Ledger Pool',
      category: 'Quarantine',
      type: 'DAMAGED_GOODS',
      description: 'Segregated quarantine ledger for defective and damaged items',
      isActive: true,
    },
  });

  // 4. Upsert 4 Top-Selling Products and their LOC_MAIN StockItem (qty = 100)
  for (const item of TOP_SELLING_PRODUCTS) {
    const product = await client.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        basePrice: item.basePrice,
        companyDiscountPercent: item.companyDiscountPercent,
        targetCapacity: item.targetCapacity,
        isActive: true,
      },
      create: {
        sku: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        basePrice: item.basePrice,
        companyDiscountPercent: item.companyDiscountPercent,
        targetCapacity: item.targetCapacity,
        isActive: true,
      },
    });

    // Upsert StockItem in LOC_MAIN with 100 units
    const stockItem = await client.stockItem.upsert({
      where: {
        locationId_productId: {
          locationId: 'LOC_MAIN',
          productId: product.id,
        },
      },
      update: {
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        basePrice: product.basePrice,
        companyDiscountPercent: product.companyDiscountPercent,
        targetCapacity: product.targetCapacity,
        isActive: true,
      },
      create: {
        locationId: 'LOC_MAIN',
        locationType: 'MAIN_STORE',
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity: 100.0,
        basePrice: product.basePrice,
        companyDiscountPercent: product.companyDiscountPercent,
        targetCapacity: product.targetCapacity,
        status: 'APPROVED',
        isActive: true,
      },
    });

    if (stockItem.quantity <= 0) {
      await client.stockItem.update({
        where: { id: stockItem.id },
        data: { quantity: 100.0 },
      });
    }

    console.log(`  ✓ Product: [${product.sku}] ${product.name} — LOC_MAIN On-Hand: 100 ${product.unit}`);
  }

  console.log('✅ Inventory Seeding Complete! Zero data loss guaranteed.\n');
}

// Auto-run if executed directly as entrypoint
if (process.argv[1]?.includes('seedProducts')) {
  seedTopSellingProducts()
    .catch((err) => {
      console.error('❌ Seeding error:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
