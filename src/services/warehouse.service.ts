import prisma from '../lib/prisma.ts';
import { AppError } from '../utils/appError.ts';
import {
  validatePositiveNumber,
  validateNonNegativeNumber,
  validateNonZeroNumber,
  validateNonEmptyString,
  validateSignatureDataUrl,
} from '../utils/inventoryValidation.ts';
import type {
  AuthenticatedUser,
  CreateProductInput,
  UpdateProductInput,
  ProductQueryParams,
  ReceivePurchaseOrderInput,
  AdjustWarehouseStockInput,
  SaveOwnerSignatureInput,
  StockItemDTO,
  ProductDTO,
} from '../types/index.ts';

/**
 * Calculates net wholesale unit price given base price and company discount percent.
 */
export function calcNetUnitPrice(basePrice: number, discountPercent: number): number {
  const discount = Math.max(0, Math.min(100, discountPercent || 0));
  return Math.round((basePrice * (1 - discount / 100)) * 100) / 100;
}

/**
 * Ensures default logical/physical inventory locations exist in the database (Idempotent bootstrap).
 */
export async function ensureDefaultLocations(tx: any = prisma): Promise<void> {
  // 1. Central Warehouse
  await tx.inventoryLocation.upsert({
    where: { id: 'LOC_MAIN' },
    update: {},
    create: {
      id: 'LOC_MAIN',
      name: 'Central Warehouse',
      category: 'Main Store',
      type: 'MAIN_STORE',
      description: 'Liyanage Hardware Central Distribution Warehouse',
      isActive: true,
    },
  });

  // 2. Default Delivery Van 01
  const existingVan = await tx.inventoryLocation.findUnique({
    where: { id: 'LOC_VAN_01' },
  });

  if (!existingVan) {
    // Attempt to link first active sales rep if available
    const firstRep = await tx.salesPerson.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    await tx.inventoryLocation.create({
      data: {
        id: 'LOC_VAN_01',
        name: 'Delivery Van 01',
        category: 'Delivery Van',
        type: 'VEHICLE',
        vehicleId: 'VAN-01',
        vehicleNumber: 'WP KDK-4521',
        driverName: 'Sunil Shantha',
        salesPersonId: firstRep?.id || null,
        description: 'Primary mobile delivery truck for hardware field distribution',
        isActive: true,
      },
    });
  }

  // 3. Quarantined Damaged Goods Pool
  await tx.inventoryLocation.upsert({
    where: { id: 'LOC_DAMAGED' },
    update: {},
    create: {
      id: 'LOC_DAMAGED',
      name: 'Damaged Goods Pool',
      category: 'Quarantine',
      type: 'DAMAGED_GOODS',
      description: 'Segregated quarantine ledger for defective and damaged items',
      isActive: true,
    },
  });
}

export const WarehouseService = {
  /**
   * Returns active products and their LOC_MAIN stock, valuation, KPIs, and recent audit movements.
   */
  async getWarehouseCatalog(filters: ProductQueryParams = {}) {
    await ensureDefaultLocations(prisma);

    const whereClause: any = { isActive: true };

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      whereClause.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { category: { contains: q } },
      ];
    }

    if (filters.category && filters.category !== 'ALL') {
      whereClause.category = filters.category;
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        stockItems: {
          where: { locationId: 'LOC_MAIN', isActive: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    let totalValue = 0;
    let totalUnits = 0;
    let lowStockCount = 0;

    const catalog = products.map((prod) => {
      const mainStockItem = prod.stockItems[0];
      const quantity = mainStockItem ? mainStockItem.quantity : 0;
      const netPrice = calcNetUnitPrice(prod.basePrice, prod.companyDiscountPercent);
      const itemValuation = Math.round(quantity * netPrice * 100) / 100;

      totalUnits += quantity;
      totalValue += itemValuation;
      if (quantity <= (prod.targetCapacity * 0.2)) {
        lowStockCount += 1;
      }

      return {
        id: prod.id,
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        category: prod.category,
        unit: prod.unit,
        basePrice: prod.basePrice,
        companyDiscountPercent: prod.companyDiscountPercent,
        netUnitPrice: netPrice,
        targetCapacity: prod.targetCapacity,
        warehouseQuantity: quantity,
        totalValue: itemValuation,
        stockItemId: mainStockItem ? mainStockItem.id : null,
        isActive: prod.isActive,
        createdAt: prod.createdAt.toISOString(),
        updatedAt: prod.updatedAt.toISOString(),
      };
    });

    // Recent movements touching LOC_MAIN
    const movements = await prisma.stockMovement.findMany({
      where: {
        OR: [{ sourceLocation: 'LOC_MAIN' }, { targetLocation: 'LOC_MAIN' }],
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    return {
      catalog,
      movements: movements.map((m) => ({
        ...m,
        timestamp: m.createdAt.toISOString(),
        createdAt: m.createdAt.toISOString(),
      })),
      kpis: {
        totalValue: Math.round(totalValue * 100) / 100,
        totalUnits,
        skuCount: products.length,
        lowStockCount,
      },
    };
  },

  /**
   * Registers a new Product SKU with opening stock in Central Warehouse.
   */
  async registerProduct(dto: CreateProductInput, user: AuthenticatedUser) {
    const sku = validateNonEmptyString(dto.sku, 'SKU Code').toUpperCase();
    const name = validateNonEmptyString(dto.name, 'Product Name');
    const category = dto.category?.trim() || 'General Hardware';
    const unit = dto.unit?.trim() || 'Unit';
    const basePrice = validateNonNegativeNumber(dto.basePrice ?? 0, 'Base Price');
    const discountPercent = validateNonNegativeNumber(dto.companyDiscountPercent ?? 0, 'Discount %');
    const targetCapacity = validatePositiveNumber(dto.targetCapacity ?? 100, 'Target Capacity');
    const initialQty = validateNonNegativeNumber(dto.initialQuantity ?? 0, 'Initial Stock Quantity');

    // Duplicate SKU check
    const existing = await prisma.product.findUnique({
      where: { sku },
    });
    if (existing) {
      if (existing.isActive) {
        throw new AppError(`SKU "${sku}" is already assigned to "${existing.name}".`, 409);
      } else {
        // If soft-deleted previously, we can reactivate or enforce new SKU
        throw new AppError(`SKU "${sku}" belongs to an archived product. Please use a unique SKU code.`, 409);
      }
    }

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);

      const product = await tx.product.create({
        data: {
          sku,
          name,
          category,
          unit,
          basePrice,
          companyDiscountPercent: discountPercent,
          targetCapacity,
          isActive: true,
        },
      });

      const netPrice = calcNetUnitPrice(basePrice, discountPercent);

      const mainStockItem = await tx.stockItem.create({
        data: {
          locationId: 'LOC_MAIN',
          locationType: 'MAIN_STORE',
          vehicleId: null,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unit: product.unit,
          quantity: initialQty,
          basePrice: product.basePrice,
          companyDiscountPercent: product.companyDiscountPercent,
          targetCapacity: product.targetCapacity,
          status: 'APPROVED',
          isActive: true,
          lastUpdatedBy: user.username,
        },
      });

      let movement = null;
      if (initialQty > 0) {
        movement = await tx.stockMovement.create({
          data: {
            movementType: 'SUPPLIER_PURCHASE_INBOUND',
            sourceLocation: 'OPENING_STOCK',
            targetLocation: 'LOC_MAIN',
            productId: product.id,
            productName: product.name,
            quantity: initialQty,
            unitPrice: netPrice,
            previousQty: 0,
            newQty: initialQty,
            reference: 'INIT-STOCK',
            performedBy: user.username,
            notes: 'Initial warehouse opening stock registration',
          },
        });
      }

      return {
        product: {
          ...product,
          createdAt: product.createdAt.toISOString(),
          updatedAt: product.updatedAt.toISOString(),
        },
        stockItem: mainStockItem,
        movement,
      };
    });
  },

  /**
   * Updates an existing Product SKU and syncs all associated StockItem entries.
   */
  async updateProduct(id: number, dto: UpdateProductInput, user: AuthenticatedUser) {
    const productId = validatePositiveNumber(id, 'Product ID');

    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!existingProduct || !existingProduct.isActive) {
      throw new AppError('Product not found or has been archived.', 404);
    }

    let sku = existingProduct.sku;
    if (dto.sku && dto.sku.trim().toUpperCase() !== existingProduct.sku) {
      sku = dto.sku.trim().toUpperCase();
      const conflict = await prisma.product.findUnique({ where: { sku } });
      if (conflict && conflict.id !== productId) {
        throw new AppError(`SKU "${sku}" is already assigned to "${conflict.name}".`, 409);
      }
    }

    const name = dto.name !== undefined ? validateNonEmptyString(dto.name, 'Product Name') : existingProduct.name;
    const category = dto.category !== undefined ? dto.category.trim() : existingProduct.category;
    const unit = dto.unit !== undefined ? dto.unit.trim() : existingProduct.unit;
    const basePrice = dto.basePrice !== undefined ? validateNonNegativeNumber(dto.basePrice, 'Base Price') : existingProduct.basePrice;
    const discountPercent = dto.companyDiscountPercent !== undefined ? validateNonNegativeNumber(dto.companyDiscountPercent, 'Discount %') : existingProduct.companyDiscountPercent;
    const targetCapacity = dto.targetCapacity !== undefined ? validatePositiveNumber(dto.targetCapacity, 'Target Capacity') : existingProduct.targetCapacity;

    return await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          sku,
          name,
          category,
          unit,
          basePrice,
          companyDiscountPercent: discountPercent,
          targetCapacity,
        },
      });

      // Synchronize metadata down to all existing active stock items
      await tx.stockItem.updateMany({
        where: { productId },
        data: {
          productName: name,
          sku,
          unit,
          basePrice,
          companyDiscountPercent: discountPercent,
          lastUpdatedBy: user.username,
        },
      });

      return {
        product: {
          ...updatedProduct,
          createdAt: updatedProduct.createdAt.toISOString(),
          updatedAt: updatedProduct.updatedAt.toISOString(),
        },
      };
    });
  },

  /**
   * Soft-deletes a product by setting isActive = false across Product and StockItem records.
   * Completely preserves historical StockMovement and DamagedGoodsRecord ledger rows.
   */
  async softDeleteWarehouseProduct(id: number, user: AuthenticatedUser) {
    const productId = validatePositiveNumber(id, 'Product ID');

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || !product.isActive) {
      throw new AppError('Product not found or already deleted.', 404);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { isActive: false },
      });

      await tx.stockItem.updateMany({
        where: { productId },
        data: { isActive: false, lastUpdatedBy: user.username },
      });

      return { success: true, message: `Product ${product.sku} soft-deleted successfully.` };
    });
  },

  /**
   * Inbound purchase order receiving into Central Warehouse.
   */
  async receivePurchaseOrder(dto: ReceivePurchaseOrderInput, user: AuthenticatedUser) {
    const supplierName = validateNonEmptyString(dto.supplierName, 'Supplier Name');
    if (!dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new AppError('Purchase order must contain at least one item.', 400);
    }

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);
      const movements = [];

      for (const item of dto.items) {
        const prodId = validatePositiveNumber(item.productId, 'Product ID');
        const qty = validatePositiveNumber(item.quantity, 'Quantity');

        const product = await tx.product.findUnique({
          where: { id: prodId },
        });
        if (!product || !product.isActive) {
          throw new AppError(`Product ID ${prodId} not found or is inactive.`, 404);
        }

        // Find or create LOC_MAIN StockItem
        let stockItem = await tx.stockItem.findUnique({
          where: {
            locationId_productId: {
              locationId: 'LOC_MAIN',
              productId: prodId,
            },
          },
        });

        const prevQty = stockItem ? stockItem.quantity : 0;
        const newQty = prevQty + qty;

        const effectiveBasePrice = item.basePrice !== undefined ? validateNonNegativeNumber(item.basePrice, 'Base Price') : product.basePrice;
        const effectiveDiscount = item.discountPercent !== undefined ? validateNonNegativeNumber(item.discountPercent, 'Discount %') : product.companyDiscountPercent;
        const netPrice = calcNetUnitPrice(effectiveBasePrice, effectiveDiscount);

        if (stockItem) {
          stockItem = await tx.stockItem.update({
            where: { id: stockItem.id },
            data: {
              quantity: newQty,
              basePrice: effectiveBasePrice,
              companyDiscountPercent: effectiveDiscount,
              isActive: true,
              lastUpdatedBy: user.username,
            },
          });
        } else {
          stockItem = await tx.stockItem.create({
            data: {
              locationId: 'LOC_MAIN',
              locationType: 'MAIN_STORE',
              vehicleId: null,
              productId: prodId,
              productName: product.name,
              sku: product.sku,
              unit: product.unit,
              quantity: newQty,
              basePrice: effectiveBasePrice,
              companyDiscountPercent: effectiveDiscount,
              targetCapacity: product.targetCapacity,
              status: 'APPROVED',
              isActive: true,
              lastUpdatedBy: user.username,
            },
          });
        }

        // Update product master pricing if updated in PO
        if (item.basePrice !== undefined || item.discountPercent !== undefined) {
          await tx.product.update({
            where: { id: prodId },
            data: {
              basePrice: effectiveBasePrice,
              companyDiscountPercent: effectiveDiscount,
            },
          });
        }

        const movement = await tx.stockMovement.create({
          data: {
            movementType: 'SUPPLIER_PURCHASE_INBOUND',
            sourceLocation: supplierName,
            targetLocation: 'LOC_MAIN',
            productId: prodId,
            productName: product.name,
            quantity: qty,
            unitPrice: netPrice,
            previousQty: prevQty,
            newQty: newQty,
            reference: dto.poNumber || `PO-${Date.now().toString().slice(-6)}`,
            performedBy: user.username || dto.performedBy || 'Storekeeper',
            notes: dto.notes || `Supplier PO delivery from ${supplierName}`,
          },
        });

        movements.push(movement);
      }

      return {
        success: true,
        movements: movements.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    });
  },

  /**
   * Adjusts central warehouse stocktake count with mandatory audit reason.
   */
  async adjustWarehouseStock(dto: AdjustWarehouseStockInput, user: AuthenticatedUser) {
    const prodId = validatePositiveNumber(dto.productId, 'Product ID');
    const delta = validateNonZeroNumber(dto.delta, 'Stock adjustment delta');
    const reason = validateNonEmptyString(dto.reason, 'Adjustment Reason');

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);

      const product = await tx.product.findUnique({
        where: { id: prodId },
      });
      if (!product || !product.isActive) {
        throw new AppError('Product not found in active catalog.', 404);
      }

      let stockItem = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: 'LOC_MAIN',
            productId: prodId,
          },
        },
      });

      const currentQty = stockItem ? stockItem.quantity : 0;
      const newQty = currentQty + delta;

      if (newQty < 0) {
        throw new AppError(
          `Cannot adjust stock below zero. Current stock: ${currentQty} ${product.unit}, attempted change: ${delta} ${product.unit}.`,
          400
        );
      }

      const netPrice = calcNetUnitPrice(product.basePrice, product.companyDiscountPercent);

      if (stockItem) {
        stockItem = await tx.stockItem.update({
          where: { id: stockItem.id },
          data: {
            quantity: newQty,
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      } else {
        stockItem = await tx.stockItem.create({
          data: {
            locationId: 'LOC_MAIN',
            locationType: 'MAIN_STORE',
            vehicleId: null,
            productId: prodId,
            productName: product.name,
            sku: product.sku,
            unit: product.unit,
            quantity: newQty,
            basePrice: product.basePrice,
            companyDiscountPercent: product.companyDiscountPercent,
            targetCapacity: product.targetCapacity,
            status: 'APPROVED',
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      }

      const movement = await tx.stockMovement.create({
        data: {
          movementType: 'WAREHOUSE_AUDIT_ADJUSTMENT',
          sourceLocation: 'LOC_MAIN',
          targetLocation: 'LOC_MAIN',
          productId: prodId,
          productName: product.name,
          quantity: Math.abs(delta),
          unitPrice: netPrice,
          previousQty: currentQty,
          newQty: newQty,
          reference: `AUD-${Date.now().toString().slice(-6)}`,
          performedBy: user.username || dto.performedBy || 'Warehouse Manager',
          notes: `${reason} (${delta > 0 ? '+' : ''}${delta}) — ${dto.notes || ''}`.trim(),
        },
      });

      return {
        success: true,
        newQuantity: newQty,
        stockItem,
        movement: {
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        },
      };
    });
  },

  /**
   * Retrieves the official Owner / Dispatcher signature from SystemSetting.
   */
  async getOwnerSignature() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'OWNER_DISPATCHER_SIGNATURE' },
    });

    if (!setting) {
      return {
        signatureData: null,
        signerName: 'W. Liyanage (Managing Director / Owner)',
        updatedAt: null,
      };
    }

    try {
      const parsed = JSON.parse(setting.value);
      return {
        signatureData: parsed.signatureData || null,
        signerName: parsed.signerName || 'W. Liyanage (Managing Director / Owner)',
        updatedAt: setting.updatedAt.toISOString(),
      };
    } catch {
      return {
        signatureData: setting.value,
        signerName: 'W. Liyanage (Managing Director / Owner)',
        updatedAt: setting.updatedAt.toISOString(),
      };
    }
  },

  /**
   * Persists the official Owner / Dispatcher signature in SystemSetting.
   */
  async saveOwnerSignature(dto: SaveOwnerSignatureInput, user: AuthenticatedUser) {
    const signatureData = validateSignatureDataUrl(dto.signatureData, 'Owner Signature');
    const signerName = dto.signerName?.trim() || 'W. Liyanage (Managing Director / Owner)';

    const payload = JSON.stringify({
      signatureData,
      signerName,
      updatedBy: user.username,
    });

    const setting = await prisma.systemSetting.upsert({
      where: { key: 'OWNER_DISPATCHER_SIGNATURE' },
      update: {
        value: payload,
        updatedBy: user.username,
      },
      create: {
        key: 'OWNER_DISPATCHER_SIGNATURE',
        value: payload,
        updatedBy: user.username,
      },
    });

    return {
      success: true,
      signatureData,
      signerName,
      updatedAt: setting.updatedAt.toISOString(),
    };
  },
};

export default WarehouseService;

