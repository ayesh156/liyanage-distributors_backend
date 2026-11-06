import prisma from '../lib/prisma.ts';
import { AppError } from '../utils/appError.ts';
import {
  validatePositiveNumber,
  validateNonNegativeNumber,
  validateNonEmptyString,
  validateSignatureDataUrl,
} from '../utils/inventoryValidation.ts';
import { ensureDefaultLocations, calcNetUnitPrice } from './warehouse.service.ts';
import type {
  AuthenticatedUser,
  LoadToVanInput,
  EditVanQtyInput,
  RecordRoadSaleInput,
  ReturnToStoreInput,
  QuarantineDamagedInput,
  UpdateDamagedStatusInput,
  SignManifestByOwnerInput,
  VerifyManifestByRepInput,
  DamagedGoodsQueryParams,
} from '../types/index.ts';

/**
 * Resolves the vehicle record along with universal "All Routes" dispatch and live SalesPerson records.
 */
export async function resolveVehicleContext(vehicleId: string = 'VAN-01', tx: any = prisma) {
  await ensureDefaultLocations(tx);

  const loc = await tx.inventoryLocation.findFirst({
    where: {
      type: 'VEHICLE',
      vehicleId,
      isActive: true,
    },
  });

  if (!loc) {
    throw new AppError(`Vehicle location "${vehicleId}" not found.`, 404);
  }

  // Resolve linked SalesPerson
  let rep = null;
  if (loc.salesPersonId) {
    rep = await tx.salesPerson.findUnique({ where: { id: loc.salesPersonId } });
  }
  if (!rep) {
    rep = await tx.salesPerson.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
  }

  // Resolve persisted vehicle profile settings (e.g. backend vehicle image URL)
  let vehicleImage = '/images/van/van_active.jpg';
  try {
    const profileSetting = await tx.systemSetting.findUnique({
      where: { key: `VEHICLE_PROFILE_${vehicleId}` },
    });
    if (profileSetting) {
      const parsed = JSON.parse(profileSetting.value);
      if (parsed.vehicleImage) {
        vehicleImage = parsed.vehicleImage;
      }
    }
  } catch (_e) {}

  return {
    locationId: loc.id,
    id: loc.vehicleId || 'VAN-01',
    vehicleId: loc.vehicleId || 'VAN-01',
    name: loc.name,
    plateNumber: loc.vehicleNumber || 'WP KDK-4521',
    vehicleNumber: loc.vehicleNumber || 'WP KDK-4521',
    driver: loc.driverName || 'Sunil Shantha',
    driverName: loc.driverName || 'Sunil Shantha',
    routeId: null,
    route: 'All Routes',
    routeName: 'All Routes',
    subRoutes: [] as string[],
    salesPersonId: rep?.id || null,
    repName: rep?.name || null,
    repPhone: rep?.phone || null,
    status: 'ACTIVE',
    vehicleImage,
  };
}

/**
 * Formats a manifest code for a given date, e.g. "MAN-20261106-01".
 */
function generateManifestNo(date: Date = new Date(), revision: number = 1): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const base = `MAN-${yyyy}${mm}${dd}-01`;
  return revision > 1 ? `${base}-R${revision}` : base;
}

export const VanStockService = {
  /**
   * Retrieves active van inventory on board the specified vehicle,
   * live route and rep details, par replenishment planner, and KPIs.
   */
  async getVanInventory(vehicleId: string = 'VAN-01') {
    await ensureDefaultLocations(prisma);
    const vehicle = await resolveVehicleContext(vehicleId, prisma);

    const [vanStockItems, mainStoreItems, allProducts, recentMovements] = await Promise.all([
      prisma.stockItem.findMany({
        where: {
          locationId: vehicle.locationId,
          isActive: true,
        },
        include: { product: true },
        orderBy: { productName: 'asc' },
      }),
      prisma.stockItem.findMany({
        where: {
          locationId: 'LOC_MAIN',
          isActive: true,
        },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      prisma.stockMovement.findMany({
        where: {
          OR: [{ sourceLocation: vehicle.locationId }, { targetLocation: vehicle.locationId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const warehouseStockMap = new Map<number, number>();
    mainStoreItems.forEach((m) => warehouseStockMap.set(m.productId, m.quantity));

    let vanTotalValue = 0;
    let vanTotalUnits = 0;
    let pendingConfirmationCount = 0;

    const items = vanStockItems.map((item) => {
      const net = calcNetUnitPrice(item.basePrice, item.companyDiscountPercent);
      const totalVal = Math.round(net * item.quantity * 100) / 100;
      vanTotalValue += totalVal;
      vanTotalUnits += item.quantity;
      if (item.status === 'PENDING_CONFIRMATION') {
        pendingConfirmationCount += 1;
      }

      return {
        id: item.id,
        locationId: item.locationId,
        locationType: item.locationType,
        vehicleId: item.vehicleId,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku || item.product?.sku || '',
        unit: item.unit || item.product?.unit || 'Unit',
        category: item.product?.category || 'General',
        quantity: item.quantity,
        basePrice: item.basePrice,
        companyDiscountPercent: item.companyDiscountPercent,
        netUnitPrice: net,
        totalValue: totalVal,
        targetCapacity: item.targetCapacity,
        status: item.status,
        confirmedBy: item.confirmedBy,
        confirmedAt: item.confirmedAt ? item.confirmedAt.toISOString() : null,
        repChecked: item.repChecked,
        repCheckedAt: item.repCheckedAt ? item.repCheckedAt.toISOString() : null,
        discrepancyFlag: item.discrepancyFlag,
        isActive: item.isActive,
      };
    });

    // Replenishment planner calculation
    let neededUnits = 0;
    let estimatedCost = 0;
    let criticalItemCount = 0;

    const replenishmentPlanner = allProducts.map((prod) => {
      const vanItem = vanStockItems.find((v) => v.productId === prod.id);
      const currentOnHand = vanItem ? vanItem.quantity : 0;
      const targetCapacity = vanItem?.targetCapacity || prod.targetCapacity || 100;
      const netPrice = calcNetUnitPrice(prod.basePrice, prod.companyDiscountPercent);
      const needed = Math.max(0, targetCapacity - currentOnHand);
      const cost = Math.round(needed * netPrice * 100) / 100;
      const availableWarehouse = warehouseStockMap.get(prod.id) || 0;

      neededUnits += needed;
      estimatedCost += cost;

      const fillRatio = targetCapacity > 0 ? (currentOnHand / targetCapacity) : 1;
      let priority = { level: 'OK', rank: 4, badgeClass: 'bg-emerald-100 text-emerald-800' };
      if (currentOnHand === 0) {
        priority = { level: 'OUT_OF_STOCK', rank: 1, badgeClass: 'bg-red-100 text-red-800' };
        criticalItemCount += 1;
      } else if (fillRatio <= 0.25) {
        priority = { level: 'CRITICAL', rank: 2, badgeClass: 'bg-amber-100 text-amber-800' };
        criticalItemCount += 1;
      } else if (fillRatio <= 0.6) {
        priority = { level: 'LOW', rank: 3, badgeClass: 'bg-blue-100 text-blue-800' };
      }

      return {
        product: {
          id: prod.id,
          sku: prod.sku,
          name: prod.name,
          category: prod.category,
          unit: prod.unit,
          basePrice: prod.basePrice,
          companyDiscountPercent: prod.companyDiscountPercent,
          targetCapacity: prod.targetCapacity,
        },
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        category: prod.category,
        unit: prod.unit,
        basePrice: prod.basePrice,
        discountPercent: prod.companyDiscountPercent,
        netUnitPrice: netPrice,
        currentOnHand,
        targetCapacity,
        restockNeeded: needed,
        estimatedCost: cost,
        priority,
        availableWarehouse,
        vanItemId: vanItem ? vanItem.id : null,
      };
    });

    return {
      vehicle,
      vanStock: items,
      replenishmentPlanner,
      movements: recentMovements.map((m) => ({
        ...m,
        timestamp: m.createdAt.toISOString(),
        createdAt: m.createdAt.toISOString(),
      })),
      kpis: {
        totalValue: Math.round(vanTotalValue * 100) / 100,
        totalUnits: vanTotalUnits,
        skuCount: items.filter((i) => i.quantity > 0).length,
        pendingConfirmationCount,
        replenishment: {
          neededUnits,
          estimatedCost: Math.round(estimatedCost * 100) / 100,
          criticalItemCount,
        },
      },
    };
  },

  /**
   * Retrieves today's DailyVanManifest or creates/upserts a daily draft.
   */
  async getDailyManifest(vehicleId: string = 'VAN-01') {
    await ensureDefaultLocations(prisma);
    const vehicle = await resolveVehicleContext(vehicleId, prisma);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    let manifest = await prisma.dailyVanManifest.findFirst({
      where: {
        vehicleId,
        manifestDate: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      orderBy: [{ manifestRevision: 'desc' }, { createdAt: 'desc' }],
    });

    const vanItems = await prisma.stockItem.findMany({
      where: {
        locationId: vehicle.locationId,
        quantity: { gt: 0 },
        isActive: true,
      },
      include: { product: true },
      orderBy: { productName: 'asc' },
    });

    let totalUnits = 0;
    let totalValue = 0;
    const itemsList = vanItems.map((item) => {
      const net = calcNetUnitPrice(item.basePrice, item.companyDiscountPercent);
      const val = Math.round(net * item.quantity * 100) / 100;
      totalUnits += item.quantity;
      totalValue += val;
      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku || item.product?.sku || '',
        unit: item.unit || item.product?.unit || 'Unit',
        quantity: item.quantity,
        basePrice: item.basePrice,
        discountPercent: item.companyDiscountPercent,
        netUnitPrice: net,
        totalValue: val,
        repChecked: item.repChecked,
        repCheckedAt: item.repCheckedAt ? item.repCheckedAt.toISOString() : null,
        discrepancyFlag: item.discrepancyFlag,
        status: item.status,
      };
    });

    if (!manifest) {
      const defaultOwnerSetting = await prisma.systemSetting.findUnique({
        where: { key: 'OWNER_DISPATCHER_SIGNATURE' },
      });
      let defaultSig = null;
      let defaultSigner = 'W. Liyanage (Managing Director / Owner)';
      if (defaultOwnerSetting) {
        try {
          const parsed = JSON.parse(defaultOwnerSetting.value);
          defaultSig = parsed.signatureData || null;
          defaultSigner = parsed.signerName || defaultSigner;
        } catch {
          defaultSig = defaultOwnerSetting.value;
        }
      }

      manifest = await prisma.dailyVanManifest.create({
        data: {
          manifestNo: generateManifestNo(new Date(), 1),
          manifestDate: new Date(),
          vehicleId,
          vehicleNumber: vehicle.vehicleNumber,
          driverName: vehicle.driverName,
          routeId: vehicle.routeId,
          routeName: vehicle.routeName,
          salesPersonId: vehicle.salesPersonId,
          repName: vehicle.repName,
          repPhone: vehicle.repPhone,
          ownerSignatureData: defaultSig,
          ownerSignedBy: defaultSigner,
          ownerSignedAt: new Date(),
          status: 'DISPATCHED',
          manifestRevision: 1,
          uncheckedCount: 0,
          totalUnits,
          totalValue: Math.round(totalValue * 100) / 100,
          itemsSnapshot: itemsList as any,
        },
      });
    }

    return {
      ...manifest,
      manifestDate: manifest.manifestDate.toISOString(),
      ownerSignedAt: manifest.ownerSignedAt ? manifest.ownerSignedAt.toISOString() : null,
      repSignedAt: manifest.repSignedAt ? manifest.repSignedAt.toISOString() : null,
      createdAt: manifest.createdAt.toISOString(),
      updatedAt: manifest.updatedAt.toISOString(),
      items: itemsList,
    };
  },

  /**
   * Retrieves historical manifests list.
   */
  async getManifestHistory(vehicleId: string = 'VAN-01') {
    const manifests = await prisma.dailyVanManifest.findMany({
      where: { vehicleId },
      orderBy: { manifestDate: 'desc' },
      take: 60,
    });

    return manifests.map((m) => ({
      ...m,
      manifestDate: m.manifestDate.toISOString(),
      ownerSignedAt: m.ownerSignedAt ? m.ownerSignedAt.toISOString() : null,
      repSignedAt: m.repSignedAt ? m.repSignedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      items: (m.itemsSnapshot as any) || [],
    }));
  },

  /**
   * Action: Load Stock from Central Warehouse to Van.
   * Atomically verifies LOC_MAIN has sufficient stock, decrements LOC_MAIN,
   * increments LOC_VAN_01, logs audit movement, and updates today's manifest.
   */
  async loadToVan(dto: LoadToVanInput, user: AuthenticatedUser) {
    const prodId = validatePositiveNumber(dto.productId, 'Product ID');
    const qty = validatePositiveNumber(dto.quantity, 'Load Quantity');
    const vehicleId = dto.vehicleId || 'VAN-01';

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);
      const vehicle = await resolveVehicleContext(vehicleId, tx);

      const product = await tx.product.findUnique({
        where: { id: prodId },
      });
      if (!product || !product.isActive) {
        throw new AppError('Product not found in active catalog.', 404);
      }

      const warehouseStock = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: 'LOC_MAIN',
            productId: prodId,
          },
        },
      });

      const currentWarehouseQty = warehouseStock ? warehouseStock.quantity : 0;
      if (currentWarehouseQty < qty) {
        throw new AppError(
          `Insufficient Central Warehouse stock for ${product.name}. Available: ${currentWarehouseQty} ${product.unit}, requested load: ${qty} ${product.unit}.`,
          400
        );
      }

      // 1. Decrement warehouse stock
      await tx.stockItem.update({
        where: { id: warehouseStock!.id },
        data: {
          quantity: currentWarehouseQty - qty,
          lastUpdatedBy: user.username,
        },
      });

      // 2. Increment van stock
      let vanItem = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: vehicle.locationId,
            productId: prodId,
          },
        },
      });

      const prevVanQty = vanItem ? vanItem.quantity : 0;
      const newVanQty = prevVanQty + qty;

      if (vanItem) {
        vanItem = await tx.stockItem.update({
          where: { id: vanItem.id },
          data: {
            quantity: newVanQty,
            status: 'PENDING_CONFIRMATION',
            repChecked: false,
            repCheckedAt: null,
            discrepancyFlag: false,
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      } else {
        vanItem = await tx.stockItem.create({
          data: {
            locationId: vehicle.locationId,
            locationType: 'VEHICLE',
            vehicleId,
            productId: prodId,
            productName: product.name,
            sku: product.sku,
            unit: product.unit,
            quantity: newVanQty,
            basePrice: product.basePrice,
            companyDiscountPercent: product.companyDiscountPercent,
            targetCapacity: product.targetCapacity,
            status: 'PENDING_CONFIRMATION',
            repChecked: false,
            repCheckedAt: null,
            discrepancyFlag: false,
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      }

      const netPrice = calcNetUnitPrice(product.basePrice, product.companyDiscountPercent);

      // 3. Log movement
      const movement = await tx.stockMovement.create({
        data: {
          movementType: 'STORE_TO_VEHICLE_LOAD',
          sourceLocation: 'LOC_MAIN',
          targetLocation: vehicle.locationId,
          productId: prodId,
          productName: product.name,
          quantity: qty,
          unitPrice: netPrice,
          previousQty: prevVanQty,
          newQty: newVanQty,
          reference: `LOAD-${Date.now().toString().slice(-6)}`,
          performedBy: user.username || dto.repName || 'Warehouse Dispatcher',
          notes: dto.notes || 'Store-to-Vehicle transfer dispatch',
        },
      });

      return {
        success: true,
        vanItem,
        movement: {
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        },
      };
    });
  },

  /**
   * Action: Modify loaded van item quantity directly with automatic warehouse reconciliation.
   * If delta > 0: decrements warehouse, increments van stock, logs STORE_TO_VEHICLE_LOAD.
   * If delta < 0: returns surplus back to warehouse, decrements van stock, logs VEHICLE_TO_STORE_RETURN.
   */
  async modifyLoadedVanQty(dto: EditVanQtyInput, user: AuthenticatedUser) {
    const prodId = validatePositiveNumber(dto.productId, 'Product ID');
    const targetQty = validateNonNegativeNumber(dto.newQuantity, 'New Quantity');
    const vehicleId = dto.vehicleId || 'VAN-01';

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);
      const vehicle = await resolveVehicleContext(vehicleId, tx);

      const product = await tx.product.findUnique({ where: { id: prodId } });
      if (!product || !product.isActive) {
        throw new AppError('Product not found in active catalog.', 404);
      }

      const vanItem = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: vehicle.locationId,
            productId: prodId,
          },
        },
      });

      const currentVanQty = vanItem ? vanItem.quantity : 0;
      const delta = targetQty - currentVanQty;

      if (delta === 0) {
        return { success: true, newQuantity: targetQty, delta: 0 };
      }

      const warehouseStock = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: 'LOC_MAIN',
            productId: prodId,
          },
        },
      });

      const currentWarehouseQty = warehouseStock ? warehouseStock.quantity : 0;

      if (delta > 0 && currentWarehouseQty < delta) {
        throw new AppError(
          `Insufficient Central Warehouse stock to increase van quantity. Available in warehouse: ${currentWarehouseQty} ${product.unit}, requested increase: ${delta} ${product.unit}.`,
          400
        );
      }

      // 1. Adjust Central Warehouse
      if (warehouseStock) {
        await tx.stockItem.update({
          where: { id: warehouseStock.id },
          data: {
            quantity: currentWarehouseQty - delta,
            lastUpdatedBy: user.username,
          },
        });
      }

      // 2. Adjust Van Stock
      let updatedVanItem;
      if (vanItem) {
        updatedVanItem = await tx.stockItem.update({
          where: { id: vanItem.id },
          data: {
            quantity: targetQty,
            status: 'PENDING_CONFIRMATION',
            repChecked: false,
            repCheckedAt: null,
            discrepancyFlag: false,
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      } else {
        updatedVanItem = await tx.stockItem.create({
          data: {
            locationId: vehicle.locationId,
            locationType: 'VEHICLE',
            vehicleId,
            productId: prodId,
            productName: product.name,
            sku: product.sku,
            unit: product.unit,
            quantity: targetQty,
            basePrice: product.basePrice,
            companyDiscountPercent: product.companyDiscountPercent,
            targetCapacity: product.targetCapacity,
            status: 'PENDING_CONFIRMATION',
            repChecked: false,
            repCheckedAt: null,
            discrepancyFlag: false,
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      }

      const netPrice = calcNetUnitPrice(product.basePrice, product.companyDiscountPercent);
      const movementType = delta > 0 ? 'STORE_TO_VEHICLE_LOAD' : 'VEHICLE_TO_STORE_RETURN';

      const movement = await tx.stockMovement.create({
        data: {
          movementType,
          sourceLocation: delta > 0 ? 'LOC_MAIN' : vehicle.locationId,
          targetLocation: delta > 0 ? vehicle.locationId : 'LOC_MAIN',
          productId: prodId,
          productName: product.name,
          quantity: Math.abs(delta),
          unitPrice: netPrice,
          previousQty: currentVanQty,
          newQty: targetQty,
          reference: `ADJ-${Date.now().toString().slice(-6)}`,
          performedBy: user.username || dto.performedBy || 'Warehouse Keeper',
          notes: dto.notes || `Adjusted van stock from ${currentVanQty} to ${targetQty} ${product.unit} (delta: ${delta > 0 ? '+' : ''}${delta})`,
        },
      });

      return {
        success: true,
        newQuantity: targetQty,
        delta,
        vanItem: updatedVanItem,
        movement: {
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        },
      };
    });
  },

  /**
   * Action: Record Road Sale Outbound from Van.
   * Deducts quantity directly from active van on-hand stock and logs movement(s).
   */
  async recordRoadSale(dto: RecordRoadSaleInput, user: AuthenticatedUser) {
    if (!dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new AppError('Sale invoice must contain at least one item.', 400);
    }
    const vehicleId = dto.vehicleId || 'VAN-01';

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);
      const vehicle = await resolveVehicleContext(vehicleId, tx);
      const movements = [];

      for (const item of dto.items) {
        const prodId = validatePositiveNumber(item.productId, 'Product ID');
        const qty = validatePositiveNumber(item.quantity, 'Sale Quantity');

        const vanItem = await tx.stockItem.findUnique({
          where: {
            locationId_productId: {
              locationId: vehicle.locationId,
              productId: prodId,
            },
          },
          include: { product: true },
        });

        if (!vanItem || vanItem.quantity < qty) {
          const available = vanItem ? vanItem.quantity : 0;
          throw new AppError(
            `Insufficient van stock for ${item.productName || 'product'}. Available: ${available}, sale quantity: ${qty}.`,
            400
          );
        }

        const prevQty = vanItem.quantity;
        const newQty = prevQty - qty;

        await tx.stockItem.update({
          where: { id: vanItem.id },
          data: {
            quantity: newQty,
            lastUpdatedBy: user.username,
          },
        });

        const netPrice = item.unitPrice || calcNetUnitPrice(vanItem.basePrice, vanItem.companyDiscountPercent);

        const movement = await tx.stockMovement.create({
          data: {
            movementType: 'VEHICLE_SALES_OUTBOUND',
            sourceLocation: vehicle.locationId,
            targetLocation: dto.customerName || 'RETAIL_CUSTOMER',
            productId: prodId,
            productName: vanItem.productName,
            quantity: qty,
            unitPrice: netPrice,
            previousQty: prevQty,
            newQty: newQty,
            reference: dto.invoiceNo || `INV-${Date.now().toString().slice(-6)}`,
            performedBy: user.username || dto.performedBy || vehicle.repName,
            notes: `Road sale invoice to ${dto.customerName || 'Hardware Retailer'}`,
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
   * Action: Return unsold stock from Van back to Central Warehouse.
   */
  async returnToWarehouse(dto: ReturnToStoreInput, user: AuthenticatedUser) {
    const prodId = validatePositiveNumber(dto.productId, 'Product ID');
    const qty = validatePositiveNumber(dto.quantity, 'Return Quantity');
    const vehicleId = dto.vehicleId || 'VAN-01';

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);
      const vehicle = await resolveVehicleContext(vehicleId, tx);

      const vanItem = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: vehicle.locationId,
            productId: prodId,
          },
        },
      });

      if (!vanItem || vanItem.quantity < qty) {
        const available = vanItem ? vanItem.quantity : 0;
        throw new AppError(
          `Cannot return more than available on the van. Available: ${available}, return quantity: ${qty}.`,
          400
        );
      }

      const prevVanQty = vanItem.quantity;
      const newVanQty = prevVanQty - qty;

      // Deduct from van
      await tx.stockItem.update({
        where: { id: vanItem.id },
        data: {
          quantity: newVanQty,
          lastUpdatedBy: user.username,
        },
      });

      // Increment warehouse
      const warehouseStock = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: 'LOC_MAIN',
            productId: prodId,
          },
        },
      });

      const prevWhQty = warehouseStock ? warehouseStock.quantity : 0;
      const newWhQty = prevWhQty + qty;

      if (warehouseStock) {
        await tx.stockItem.update({
          where: { id: warehouseStock.id },
          data: {
            quantity: newWhQty,
            lastUpdatedBy: user.username,
          },
        });
      }

      const netPrice = calcNetUnitPrice(vanItem.basePrice, vanItem.companyDiscountPercent);

      const movement = await tx.stockMovement.create({
        data: {
          movementType: 'VEHICLE_TO_STORE_RETURN',
          sourceLocation: vehicle.locationId,
          targetLocation: 'LOC_MAIN',
          productId: prodId,
          productName: vanItem.productName,
          quantity: qty,
          unitPrice: netPrice,
          previousQty: prevVanQty,
          newQty: newVanQty,
          reference: `RET-${Date.now().toString().slice(-6)}`,
          performedBy: user.username || dto.performedBy || vehicle.repName,
          notes: dto.reason || 'Unsold stock returned to Central Warehouse',
        },
      });

      return {
        success: true,
        movement: {
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        },
      };
    });
  },

  /**
   * Action: Soft Delete Van Stock Item.
   * If quantity > 0, returns remaining units to LOC_MAIN with audit movement before soft-deleting.
   */
  async softDeleteVanStockItem(stockItemId: number, user: AuthenticatedUser) {
    const id = validatePositiveNumber(stockItemId, 'Stock Item ID');

    return await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } });
      if (!item || !item.isActive) {
        throw new AppError('Van stock item not found or already deleted.', 404);
      }

      // If sellable quantity remains on the truck, safely return it to Central Warehouse
      if (item.quantity > 0) {
        const whItem = await tx.stockItem.findUnique({
          where: {
            locationId_productId: {
              locationId: 'LOC_MAIN',
              productId: item.productId,
            },
          },
        });

        if (whItem) {
          await tx.stockItem.update({
            where: { id: whItem.id },
            data: {
              quantity: whItem.quantity + item.quantity,
              lastUpdatedBy: user.username,
            },
          });
        }

        const netPrice = calcNetUnitPrice(item.basePrice, item.companyDiscountPercent);

        await tx.stockMovement.create({
          data: {
            movementType: 'VEHICLE_TO_STORE_RETURN',
            sourceLocation: item.locationId,
            targetLocation: 'LOC_MAIN',
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: netPrice,
            previousQty: item.quantity,
            newQty: 0,
            reference: `RM-ITEM-${item.id}`,
            performedBy: user.username,
            notes: `Auto-reconciled remaining van stock back to Central Warehouse upon line-item removal`,
          },
        });
      }

      await tx.stockItem.update({
        where: { id },
        data: {
          quantity: 0,
          isActive: false,
          lastUpdatedBy: user.username,
        },
      });

      return { success: true, message: `Van stock item ${item.productName} removed and reconciled.` };
    });
  },

  /**
   * Action: Log Damaged Goods & Quarantine.
   * Defective items are strictly segregated into LOC_DAMAGED pool and DamagedGoodsRecord.
   */
  async quarantineDamagedGoods(dto: QuarantineDamagedInput, user: AuthenticatedUser) {
    const prodId = validatePositiveNumber(dto.productId, 'Product ID');
    const qty = validatePositiveNumber(dto.quantity, 'Damaged Quantity');
    const reason = validateNonEmptyString(dto.reason, 'Damage Reason');
    const fromLocation = dto.fromLocation || 'VEHICLE';

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);

      const product = await tx.product.findUnique({ where: { id: prodId } });
      if (!product || !product.isActive) {
        throw new AppError('Product not found.', 404);
      }

      const netPrice = dto.unitPrice || calcNetUnitPrice(product.basePrice, product.companyDiscountPercent);
      const totalLoss = Math.round(netPrice * qty * 100) / 100;

      // 1. Deduct from originating location
      const originLocId = fromLocation === 'VEHICLE' ? 'LOC_VAN_01' : 'LOC_MAIN';
      const originStock = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: originLocId,
            productId: prodId,
          },
        },
      });

      if (originStock) {
        if (originStock.quantity < qty) {
          throw new AppError(
            `Cannot quarantine more than on-hand stock at ${fromLocation}. Available: ${originStock.quantity}, requested quarantine: ${qty}.`,
            400
          );
        }
        await tx.stockItem.update({
          where: { id: originStock.id },
          data: {
            quantity: Math.max(0, originStock.quantity - qty),
            lastUpdatedBy: user.username,
          },
        });
      }

      // 2. Add to Quarantined Pool
      let damagedStock = await tx.stockItem.findUnique({
        where: {
          locationId_productId: {
            locationId: 'LOC_DAMAGED',
            productId: prodId,
          },
        },
      });

      if (damagedStock) {
        await tx.stockItem.update({
          where: { id: damagedStock.id },
          data: {
            quantity: damagedStock.quantity + qty,
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      } else {
        await tx.stockItem.create({
          data: {
            locationId: 'LOC_DAMAGED',
            locationType: 'DAMAGED_GOODS',
            vehicleId: null,
            productId: prodId,
            productName: product.name,
            sku: product.sku,
            unit: product.unit,
            quantity: qty,
            basePrice: product.basePrice,
            companyDiscountPercent: product.companyDiscountPercent,
            targetCapacity: 0,
            status: 'APPROVED',
            isActive: true,
            lastUpdatedBy: user.username,
          },
        });
      }

      const assignedManifest = dto.manifestNo || dto.sourceManifestNo || null;
      const parsedLoadDate = dto.loadDate ? new Date(dto.loadDate) : null;

      // 3. Create DamagedGoodsRecord
      const record = await tx.damagedGoodsRecord.create({
        data: {
          vehicleId: fromLocation === 'VEHICLE' ? 'VAN-01' : 'MAIN_STORE',
          productId: prodId,
          productName: product.name,
          sku: product.sku,
          unit: product.unit,
          quantity: qty,
          unitPrice: netPrice,
          totalValue: totalLoss,
          reason,
          sourceInvoiceNo: dto.sourceInvoiceNo || null,
          manifestNo: assignedManifest || '',
          loadDate: parsedLoadDate,
          reportedBy: user.username || dto.reportedBy || 'Kamal Perera',
          status: 'LOGGED',
          isActive: true,
        },
      });

      // 4. Log Movement
      const movement = await tx.stockMovement.create({
        data: {
          movementType: 'RETURN_TO_DAMAGED_POOL',
          sourceLocation: originLocId,
          targetLocation: 'LOC_DAMAGED',
          productId: prodId,
          productName: product.name,
          quantity: qty,
          unitPrice: netPrice,
          previousQty: originStock ? originStock.quantity : 0,
          newQty: originStock ? Math.max(0, originStock.quantity - qty) : 0,
          reference: assignedManifest || dto.sourceInvoiceNo || `DMG-${Date.now().toString().slice(-6)}`,
          manifestNo: assignedManifest || '',
          performedBy: user.username || dto.reportedBy || 'Kamal Perera',
          notes: reason,
        },
      });

      return {
        success: true,
        record: {
          ...record,
          manifestNo: record.manifestNo || assignedManifest || null,
          sourceManifestNo: record.manifestNo || assignedManifest || null,
          loadDate: record.loadDate ? record.loadDate.toISOString() : null,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        },
        movement: {
          ...movement,
          timestamp: movement.createdAt.toISOString(),
          createdAt: movement.createdAt.toISOString(),
        },
      };
    });
  },

  /**
   * Retrieves quarantined damaged goods list and KPIs.
   */
  async getDamagedGoodsList(filters: DamagedGoodsQueryParams = {}) {
    const whereClause: any = { isActive: true };

    if (filters.status && (filters.status as string) !== 'ALL') {
      whereClause.status = filters.status;
    }
    if (filters.vehicleId) {
      whereClause.vehicleId = filters.vehicleId;
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      whereClause.OR = [
        { productName: { contains: q } },
        { sku: { contains: q } },
        { reason: { contains: q } },
      ];
    }

    const records = await prisma.damagedGoodsRecord.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    let totalLossValue = 0;
    let totalDamagedUnits = 0;

    const list = records.map((r) => {
      totalLossValue += r.totalValue;
      totalDamagedUnits += r.quantity;
      return {
        ...r,
        manifestNo: r.manifestNo || null,
        sourceManifestNo: r.manifestNo || null,
        loadDate: r.loadDate ? r.loadDate.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    return {
      records: list,
      kpis: {
        totalValue: Math.round(totalLossValue * 100) / 100,
        totalUnits: totalDamagedUnits,
        recordCount: records.length,
      },
    };
  },

  /**
   * Updates status of a quarantined damaged goods record (INSPECTED, WRITTEN_OFF, VENDOR_RETURN).
   */
  async updateDamagedStatus(id: number, dto: UpdateDamagedStatusInput, user?: AuthenticatedUser) {
    const recordId = validatePositiveNumber(id, 'Damaged Record ID');
    if (recordId > 2147483647) {
      throw new AppError('Damaged Record ID exceeds maximum 32-bit integer range.', 400);
    }
    const newStatus = dto.status || (dto as any).newStatus;
    const validStatuses = ['LOGGED', 'INSPECTED', 'WRITTEN_OFF', 'VENDOR_RETURN'];
    if (!newStatus || !validStatuses.includes(newStatus)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const performedBy = user?.username || (dto as any).reportedBy || 'Warehouse Manager';

    return await prisma.$transaction(async (tx) => {
      const record = await tx.damagedGoodsRecord.findUnique({ where: { id: recordId } });
      if (!record || !record.isActive) {
        throw new AppError('Damaged goods record not found.', 404);
      }

      // Update the damaged goods record with the new status
      const updated = await tx.damagedGoodsRecord.update({
        where: { id: recordId },
        data: {
          status: newStatus,
          resolutionNotes: dto.resolutionNotes || record.resolutionNotes,
        },
      });

      let movement = null;
      if (newStatus === 'WRITTEN_OFF') {
        // Adjust quarantined stock item in LOC_DAMAGED if present
        try {
          const damagedStock = await tx.stockItem.findUnique({
            where: {
              locationId_productId: {
                locationId: 'LOC_DAMAGED',
                productId: record.productId,
              },
            },
          });
          if (damagedStock) {
            await tx.stockItem.update({
              where: { id: damagedStock.id },
              data: {
                quantity: Math.max(0, damagedStock.quantity - record.quantity),
                lastUpdatedBy: performedBy,
              },
            });
          }
        } catch (stockErr) {
          console.warn('[updateDamagedStatus] Warning adjusting LOC_DAMAGED stock item:', stockErr);
        }

        try {
          movement = await tx.stockMovement.create({
            data: {
              movementType: 'DAMAGED_WRITE_OFF',
              sourceLocation: 'LOC_DAMAGED',
              targetLocation: 'SCRAP_DISPOSAL',
              productId: record.productId,
              productName: record.productName,
              quantity: record.quantity,
              unitPrice: record.unitPrice,
              previousQty: record.quantity,
              newQty: 0,
              reference: `WO-${record.id}`,
              manifestNo: record.manifestNo || '',
              performedBy,
              notes: dto.resolutionNotes || 'Approved for scrap write-off',
            },
          });
        } catch (movErr) {
          console.warn('[updateDamagedStatus] Warning creating write-off movement:', movErr);
        }
      } else if (newStatus === 'VENDOR_RETURN') {
        try {
          const damagedStock = await tx.stockItem.findUnique({
            where: {
              locationId_productId: {
                locationId: 'LOC_DAMAGED',
                productId: record.productId,
              },
            },
          });
          if (damagedStock) {
            await tx.stockItem.update({
              where: { id: damagedStock.id },
              data: {
                quantity: Math.max(0, damagedStock.quantity - record.quantity),
                lastUpdatedBy: performedBy,
              },
            });
          }
        } catch (stockErr) {
          console.warn('[updateDamagedStatus] Warning adjusting LOC_DAMAGED stock item:', stockErr);
        }

        try {
          movement = await tx.stockMovement.create({
            data: {
              movementType: 'DAMAGED_VENDOR_RETURN',
              sourceLocation: 'LOC_DAMAGED',
              targetLocation: 'SUPPLIER_WARRANTY',
              productId: record.productId,
              productName: record.productName,
              quantity: record.quantity,
              unitPrice: record.unitPrice,
              previousQty: record.quantity,
              newQty: 0,
              reference: `VR-${record.id}`,
              manifestNo: record.manifestNo || '',
              performedBy,
              notes: dto.resolutionNotes || 'Returned to supplier for warranty replacement',
            },
          });
        } catch (movErr) {
          console.warn('[updateDamagedStatus] Warning creating vendor return movement:', movErr);
        }
      }

      return {
        success: true,
        record: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
        movement: movement
          ? {
              ...movement,
              createdAt: movement.createdAt.toISOString(),
            }
          : null,
      };
    });
  },

  /**
   * Soft delete damaged goods record.
   */
  async softDeleteDamagedRecord(id: number, user: AuthenticatedUser) {
    const recordId = validatePositiveNumber(id, 'Damaged Record ID');

    const record = await prisma.damagedGoodsRecord.findUnique({ where: { id: recordId } });
    if (!record || !record.isActive) {
      throw new AppError('Damaged goods record not found or already deleted.', 404);
    }

    await prisma.damagedGoodsRecord.update({
      where: { id: recordId },
      data: { isActive: false },
    });

    return { success: true, message: `Damaged record #${recordId} soft-deleted successfully.` };
  },

  /**
   * Stamped with Owner signature and dispatches / re-dispatches Daily Manifest.
   */
  async signManifestByOwner(manifestId: string | undefined, dto: SignManifestByOwnerInput, user: AuthenticatedUser) {
    const signatureData = dto.signatureData ? validateSignatureDataUrl(dto.signatureData, 'Owner Signature') : null;
    const signer = dto.dispatcherName || 'W. Liyanage (Managing Director / Owner)';
    const vehicleId = 'VAN-01';

    return await prisma.$transaction(async (tx) => {
      const vehicle = await resolveVehicleContext(vehicleId, tx);

      let targetManifest = manifestId
        ? await tx.dailyVanManifest.findUnique({ where: { id: manifestId } })
        : await tx.dailyVanManifest.findFirst({
            where: { vehicleId },
            orderBy: { createdAt: 'desc' },
          });

      const nextRev = targetManifest ? targetManifest.manifestRevision + 1 : 1;
      const manifestNo = targetManifest ? generateManifestNo(new Date(), nextRev) : generateManifestNo(new Date(), 1);

      // Snapshot active van items
      const vanItems = await tx.stockItem.findMany({
        where: { locationId: vehicle.locationId, quantity: { gt: 0 }, isActive: true },
        include: { product: true },
        orderBy: { productName: 'asc' },
      });

      let totalUnits = 0;
      let totalValue = 0;
      const itemsList = vanItems.map((v) => {
        const net = calcNetUnitPrice(v.basePrice, v.companyDiscountPercent);
        const val = Math.round(net * v.quantity * 100) / 100;
        totalUnits += v.quantity;
        totalValue += val;
        return {
          id: v.id,
          productId: v.productId,
          productName: v.productName,
          sku: v.sku || v.product?.sku || '',
          unit: v.unit || v.product?.unit || 'Unit',
          quantity: v.quantity,
          basePrice: v.basePrice,
          discountPercent: v.companyDiscountPercent,
          netUnitPrice: net,
          totalValue: val,
          repChecked: v.repChecked,
          repCheckedAt: v.repCheckedAt ? v.repCheckedAt.toISOString() : null,
          discrepancyFlag: v.discrepancyFlag,
          status: v.status,
        };
      });

      // Revision preservation: if existing revision already dispatched, branch to a new revision record
      const existingWithNo = await tx.dailyVanManifest.findUnique({ where: { manifestNo } });
      let updated;

      if (existingWithNo) {
        updated = await tx.dailyVanManifest.update({
          where: { id: existingWithNo.id },
          data: {
            manifestRevision: nextRev,
            ownerSignatureData: signatureData || existingWithNo.ownerSignatureData,
            ownerSignedBy: signer,
            ownerSignedAt: new Date(),
            status: 'DISPATCHED',
            itemsSnapshot: itemsList as any,
            totalUnits,
            totalValue: Math.round(totalValue * 100) / 100,
            repSignatureData: null,
            repSignedBy: null,
            repSignedAt: null,
            uncheckedCount: 0,
          },
        });
      } else if (targetManifest && targetManifest.status !== 'DRAFT') {
        updated = await tx.dailyVanManifest.create({
          data: {
            manifestNo,
            manifestRevision: nextRev,
            vehicleId,
            vehicleNumber: vehicle.vehicleNumber,
            driverName: vehicle.driverName,
            routeId: vehicle.routeId,
            routeName: vehicle.routeName,
            salesPersonId: vehicle.salesPersonId,
            repName: vehicle.repName,
            repPhone: vehicle.repPhone,
            ownerSignatureData: signatureData || targetManifest.ownerSignatureData,
            ownerSignedBy: signer,
            ownerSignedAt: new Date(),
            status: 'DISPATCHED',
            itemsSnapshot: itemsList as any,
            totalUnits,
            totalValue: Math.round(totalValue * 100) / 100,
            repSignatureData: null,
            repSignedBy: null,
            repSignedAt: null,
            uncheckedCount: 0,
          },
        });
      } else {
        updated = await tx.dailyVanManifest.upsert({
          where: { id: targetManifest?.id || 'new-uuid-placeholder' },
          update: {
            manifestNo,
            manifestRevision: nextRev,
            ownerSignatureData: signatureData || targetManifest?.ownerSignatureData,
            ownerSignedBy: signer,
            ownerSignedAt: new Date(),
            status: 'DISPATCHED',
            itemsSnapshot: itemsList as any,
            totalUnits,
            totalValue: Math.round(totalValue * 100) / 100,
            repSignatureData: null,
            repSignedBy: null,
            repSignedAt: null,
            uncheckedCount: 0,
          },
          create: {
            manifestNo,
            manifestRevision: 1,
            vehicleId,
            vehicleNumber: vehicle.vehicleNumber,
            driverName: vehicle.driverName,
            routeId: vehicle.routeId,
            routeName: vehicle.routeName,
            salesPersonId: vehicle.salesPersonId,
            repName: vehicle.repName,
            repPhone: vehicle.repPhone,
            ownerSignatureData: signatureData,
            ownerSignedBy: signer,
            ownerSignedAt: new Date(),
            status: 'DISPATCHED',
            itemsSnapshot: itemsList as any,
            totalUnits,
            totalValue: Math.round(totalValue * 100) / 100,
          },
        });
      }

      return {
        success: true,
        manifest: {
          ...updated,
          manifestDate: updated.manifestDate.toISOString(),
          ownerSignedAt: updated.ownerSignedAt ? updated.ownerSignedAt.toISOString() : null,
          repSignedAt: updated.repSignedAt ? updated.repSignedAt.toISOString() : null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          items: itemsList,
        },
      };
    });
  },

  /**
   * Verifies manifest with sales representative digital signature.
   * Evaluates checked items vs unchecked items to determine REP_ACCEPTED or PARTIAL_DISCREPANCY.
   * Allows signing for any manifest that is DISPATCHED or PENDING regardless of revision number.
   */
  async verifyManifestByRep(manifestNo: string, dto: VerifyManifestByRepInput) {
    const code = validateNonEmptyString(manifestNo, 'Manifest Number');
    const rawSignature = dto.repSignature || dto.signatureData || dto.signature;
    const signatureData = validateSignatureDataUrl(rawSignature, 'Representative Signature');
    const repName = dto.repName?.trim() || 'Kamal Perera';

    return await prisma.$transaction(async (tx) => {
      const manifest = await tx.dailyVanManifest.findUnique({
        where: { manifestNo: code },
      });
      if (!manifest) {
        throw new AppError(`Manifest "${code}" not found.`, 404);
      }

      // Allow signing for any manifest that is DISPATCHED or PENDING regardless of revision number
      if (manifest.status !== 'DISPATCHED' && manifest.status !== 'PENDING') {
        throw new AppError('This manifest is archived or already signed.', 400);
      }

      const vehicle = await resolveVehicleContext(manifest.vehicleId, tx);

      // Active van items
      const vanItems = await tx.stockItem.findMany({
        where: { locationId: vehicle.locationId, quantity: { gt: 0 }, isActive: true },
        include: { product: true },
      });

      const checkedItemMap = new Map<number, boolean>();
      if (dto.items && Array.isArray(dto.items)) {
        dto.items.forEach((i) => checkedItemMap.set(i.itemId, Boolean(i.repChecked)));
      } else {
        // If not itemized in dto, mark all active items as checked (repChecked = true)
        vanItems.forEach((i) => checkedItemMap.set(i.id, true));
      }

      let uncheckedCount = 0;
      const now = new Date();

      for (const item of vanItems) {
        const isChecked = checkedItemMap.has(item.id) ? checkedItemMap.get(item.id)! : item.repChecked;
        if (isChecked) {
          await tx.stockItem.update({
            where: { id: item.id },
            data: {
              status: 'APPROVED',
              repChecked: true,
              repCheckedAt: item.repCheckedAt || now,
              discrepancyFlag: false,
              confirmedBy: repName,
              confirmedAt: now,
            },
          });
        } else {
          uncheckedCount += 1;
          await tx.stockItem.update({
            where: { id: item.id },
            data: {
              status: 'PENDING_CONFIRMATION',
              repChecked: false,
              repCheckedAt: null,
              discrepancyFlag: true,
              confirmedBy: null,
              confirmedAt: null,
            },
          });
        }
      }

      // Set status = "REP_ACCEPTED" upon full verification or PARTIAL_DISCREPANCY if items are unchecked
      const finalStatus = uncheckedCount === 0 ? 'REP_ACCEPTED' : 'PARTIAL_DISCREPANCY';

      // Re-snapshot van items
      const updatedVanItems = await tx.stockItem.findMany({
        where: { locationId: vehicle.locationId, quantity: { gt: 0 }, isActive: true },
        include: { product: true },
      });

      const itemsList = updatedVanItems.map((v) => {
        const net = calcNetUnitPrice(v.basePrice, v.companyDiscountPercent);
        const val = Math.round(net * v.quantity * 100) / 100;
        return {
          id: v.id,
          productId: v.productId,
          productName: v.productName,
          sku: v.sku || v.product?.sku || '',
          unit: v.unit || v.product?.unit || 'Unit',
          quantity: v.quantity,
          basePrice: v.basePrice,
          discountPercent: v.companyDiscountPercent,
          netUnitPrice: net,
          totalValue: val,
          repChecked: v.repChecked,
          repCheckedAt: v.repCheckedAt ? v.repCheckedAt.toISOString() : null,
          discrepancyFlag: v.discrepancyFlag,
          status: v.status,
        };
      });

      const updatedManifest = await tx.dailyVanManifest.update({
        where: { id: manifest.id },
        data: {
          repSignatureData: signatureData,
          repSignedBy: repName,
          repSignedAt: now,
          status: finalStatus,
          uncheckedCount,
          itemsSnapshot: itemsList as any,
        },
      });

      return {
        success: true,
        isFullVerification: uncheckedCount === 0,
        uncheckedCount,
        manifest: {
          ...updatedManifest,
          repSignature: updatedManifest.repSignatureData,
          manifestDate: updatedManifest.manifestDate.toISOString(),
          ownerSignedAt: updatedManifest.ownerSignedAt ? updatedManifest.ownerSignedAt.toISOString() : null,
          repSignedAt: updatedManifest.repSignedAt ? updatedManifest.repSignedAt.toISOString() : null,
          createdAt: updatedManifest.createdAt.toISOString(),
          updatedAt: updatedManifest.updatedAt.toISOString(),
          items: itemsList,
        },
      };
    });
  },

  /**
   * Public Share View Manifest Lookup (Zero Login WhatsApp Link).
   * Exposes ONLY non-sensitive manifest data and item list.
   */
  async getPublicManifestShare(manifestNo: string) {
    const code = validateNonEmptyString(manifestNo, 'Manifest Code');

    const manifest = await prisma.dailyVanManifest.findUnique({
      where: { manifestNo: code },
    });

    if (!manifest) {
      throw new AppError(`Manifest "${code}" not found.`, 404);
    }

    const vehicle = await resolveVehicleContext(manifest.vehicleId, prisma);

    // Active Manifest Resolution: evaluate newest revision for this van on this manifest date
    const dayStart = new Date(manifest.manifestDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(manifest.manifestDate);
    dayEnd.setHours(23, 59, 59, 999);

    const latestManifest = await prisma.dailyVanManifest.findFirst({
      where: {
        vehicleId: manifest.vehicleId,
        manifestDate: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
      orderBy: [
        { manifestRevision: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const isLatestRevision =
      !latestManifest ||
      latestManifest.id === manifest.id ||
      latestManifest.manifestNo === manifest.manifestNo ||
      latestManifest.manifestRevision <= manifest.manifestRevision;

    const statusUpper = (manifest.status || '').toUpperCase();
    const requiresRepSignature =
      statusUpper === 'DISPATCHED' || statusUpper === 'PENDING' || !manifest.repSignatureData;
    const isActive = isLatestRevision && (requiresRepSignature || statusUpper === 'FULLY_VERIFIED' || statusUpper === 'PARTIAL_DISCREPANCY');
    const isHistorical = !isLatestRevision;

    let items = (manifest.itemsSnapshot as any[]) || [];
    if (!items || items.length === 0) {
      const liveVanItems = await prisma.stockItem.findMany({
        where: { locationId: vehicle.locationId, quantity: { gt: 0 }, isActive: true },
        include: { product: true },
      });
      items = liveVanItems.map((v) => ({
        id: v.id,
        productId: v.productId,
        productName: v.productName,
        sku: v.sku || v.product?.sku || '',
        unit: v.unit || v.product?.unit || 'Unit',
        quantity: v.quantity,
        basePrice: v.basePrice,
        discountPercent: v.companyDiscountPercent,
        netUnitPrice: calcNetUnitPrice(v.basePrice, v.companyDiscountPercent),
        totalValue: Math.round(calcNetUnitPrice(v.basePrice, v.companyDiscountPercent) * v.quantity * 100) / 100,
        repChecked: v.repChecked,
        repCheckedAt: v.repCheckedAt ? v.repCheckedAt.toISOString() : null,
        discrepancyFlag: v.discrepancyFlag,
        status: v.status,
      }));
    }

    return {
      manifestNo: manifest.manifestNo,
      manifestDate: manifest.manifestDate.toISOString(),
      manifestRevision: manifest.manifestRevision,
      status: manifest.status,
      isLatestRevision,
      isActive,
      isHistorical,
      latestManifestNo: latestManifest?.manifestNo || manifest.manifestNo,
      vehicle: {
        id: vehicle.vehicleId,
        vehicleNumber: manifest.vehicleNumber || vehicle.vehicleNumber,
        driverName: manifest.driverName || vehicle.driverName,
        route: manifest.routeName || vehicle.route,
        repName: manifest.repName || vehicle.repName,
        repPhone: manifest.repPhone || vehicle.repPhone,
      },
      ownerSignatureData: manifest.ownerSignatureData,
      ownerSignedBy: manifest.ownerSignedBy,
      ownerSignedAt: manifest.ownerSignedAt ? manifest.ownerSignedAt.toISOString() : null,
      repSignatureData: manifest.repSignatureData,
      repSignedBy: manifest.repSignedBy,
      repSignedAt: manifest.repSignedAt ? manifest.repSignedAt.toISOString() : null,
      totalUnits: manifest.totalUnits,
      totalValue: manifest.totalValue,
      uncheckedCount: manifest.uncheckedCount,
      items,
    };
  },
};

export default VanStockService;
