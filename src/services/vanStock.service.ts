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
  ReconcileEveningChecksInput,
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
  } catch (_e) { }

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

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [vanStockItems, mainStoreItems, allProducts, recentMovements, todayManifest] = await Promise.all([
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
      prisma.dailyVanManifest.findFirst({
        where: {
          vehicleId,
          manifestDate: { gte: todayStart, lte: todayEnd },
        },
        orderBy: [{ manifestRevision: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const warehouseStockMap = new Map<number, number>();
    mainStoreItems.forEach((m) => warehouseStockMap.set(m.productId, m.quantity));

    const snapshotMap = new Map<number, any>();
    if (todayManifest && Array.isArray(todayManifest.itemsSnapshot)) {
      (todayManifest.itemsSnapshot as any[]).forEach((s) => {
        if (s && s.id) snapshotMap.set(s.id, s);
      });
    }

    let vanTotalValue = 0;
    let vanTotalUnits = 0;
    let pendingConfirmationCount = 0;

    const items = vanStockItems.map((item) => {
      const sku = item.sku || item.product?.sku || '';
      // Canonical StockItem vehicle balance
      const currentEffectiveQty = item.quantity;

      const net = calcNetUnitPrice(item.basePrice, item.companyDiscountPercent);
      const totalVal = Math.round(net * currentEffectiveQty * 100) / 100;
      vanTotalValue += totalVal;
      vanTotalUnits += currentEffectiveQty;
      if (item.status === 'PENDING_CONFIRMATION') {
        pendingConfirmationCount += 1;
      }

      const snap = snapshotMap.get(item.id);

      return {
        id: item.id,
        locationId: item.locationId,
        locationType: item.locationType,
        vehicleId: item.vehicleId,
        productId: item.productId,
        productName: item.productName,
        sku,
        unit: item.unit || item.product?.unit || 'Unit',
        category: item.product?.category || 'General',
        quantity: currentEffectiveQty,
        basePrice: item.basePrice,
        companyDiscountPercent: item.companyDiscountPercent,
        netUnitPrice: net,
        totalValue: totalVal,
        targetCapacity: item.targetCapacity,
        status: item.status,
        confirmedBy: item.confirmedBy,
        confirmedAt: item.confirmedAt ? item.confirmedAt.toISOString() : null,
        repChecked: snap ? Boolean(snap.repChecked) : false,
        eveningReconciled: snap ? Boolean(snap.eveningReconciled) : false,
        repCheckedAt: snap?.repCheckedAt ? String(snap.repCheckedAt) : null,
        discrepancyFlag: snap ? Boolean(snap.discrepancyFlag) : false,
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
  async getDailyManifest(vehicleId: string = 'VAN-01', dateStr?: string) {
    await ensureDefaultLocations(prisma);
    const vehicle = await resolveVehicleContext(vehicleId, prisma);

    let targetDate = new Date();
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        targetDate = new Date(y, m - 1, d, 12, 0, 0);
      }
    }

    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    let manifest = await prisma.dailyVanManifest.findFirst({
      where: {
        vehicleId,
        manifestDate: {
          gte: dayStart,
          lte: dayEnd,
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

    const snapshotMap = new Map<number, any>();
    if (manifest && Array.isArray(manifest.itemsSnapshot)) {
      (manifest.itemsSnapshot as any[]).forEach((s) => {
        if (s && s.id) snapshotMap.set(s.id, s);
      });
    }

    const morningCheckedArr: string[] = Array.isArray(manifest?.morningCheckedItems)
      ? (manifest?.morningCheckedItems as any[]).map(String)
      : [];
    const eveningCheckedArr: string[] = Array.isArray(manifest?.eveningCheckedItems)
      ? (manifest?.eveningCheckedItems as any[]).map(String)
      : [];

    let totalUnits = 0;
    let totalValue = 0;
    const itemsList = vanItems.map((item) => {
      const net = calcNetUnitPrice(item.basePrice, item.companyDiscountPercent);
      const val = Math.round(net * item.quantity * 100) / 100;
      totalUnits += item.quantity;
      totalValue += val;
      const snap = snapshotMap.get(item.id);

      const sku = item.sku || item.product?.sku || '';
      const pidStr = item.productId ? String(item.productId) : '';
      const idStr = String(item.id);

      const isMorning = Boolean(
        snap?.repChecked ||
        (sku && morningCheckedArr.includes(sku)) ||
        (pidStr && morningCheckedArr.includes(pidStr)) ||
        morningCheckedArr.includes(idStr)
      );

      const isEvening = Boolean(
        snap?.eveningReconciled ||
        (sku && eveningCheckedArr.includes(sku)) ||
        (pidStr && eveningCheckedArr.includes(pidStr)) ||
        eveningCheckedArr.includes(idStr)
      );

      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku,
        unit: item.unit || item.product?.unit || 'Unit',
        quantity: item.quantity,
        basePrice: item.basePrice,
        discountPercent: item.companyDiscountPercent,
        netUnitPrice: net,
        totalValue: val,
        repChecked: isMorning,
        eveningReconciled: isEvening,
        repCheckedAt: snap?.repCheckedAt ? String(snap.repCheckedAt) : null,
        discrepancyFlag: snap ? Boolean(snap.discrepancyFlag) : false,
        status: item.status,
      };
    });

    if (!manifest) {
      manifest = await prisma.dailyVanManifest.create({
        data: {
          manifestNo: generateManifestNo(targetDate, 1),
          manifestDate: targetDate,
          vehicleId,
          vehicleNumber: vehicle.vehicleNumber,
          driverName: vehicle.driverName,
          routeId: vehicle.routeId,
          routeName: vehicle.routeName,
          salesPersonId: vehicle.salesPersonId,
          repName: vehicle.repName,
          repPhone: vehicle.repPhone,
          ownerSignatureData: null,
          ownerSignedBy: null,
          ownerSignedAt: null,
          status: 'DRAFT',
          manifestRevision: 1,
          uncheckedCount: totalUnits > 0 ? vanItems.length : 0,
          totalUnits,
          totalValue: Math.round(totalValue * 100) / 100,
          morningCheckedItems: [],
          eveningCheckedItems: [],
          itemsSnapshot: itemsList as any,
        },
      });
    }

    return {
      ...manifest,
      morningCheckedItems: manifest.morningCheckedItems || [],
      eveningCheckedItems: manifest.eveningCheckedItems || [],
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
      morningCheckedItems: m.morningCheckedItems || [],
      eveningCheckedItems: m.eveningCheckedItems || [],
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
   * Supports both batch items array and single-item loading.
   * Atomically verifies LOC_MAIN has sufficient stock, decrements LOC_MAIN,
   * increments LOC_VAN_01, logs audit movement, and updates today's manifest.
   */
  async loadToVan(dto: LoadToVanInput, user?: AuthenticatedUser) {
    const vehicleId = dto.vehicleId || 'VAN-01';
    const rawItems: Array<{ productId: any; quantity: any; notes?: string }> =
      Array.isArray(dto.items) && dto.items.length > 0
        ? dto.items
        : [{ productId: dto.productId, quantity: dto.quantity, notes: dto.notes }];

    if (rawItems.length === 0) {
      throw new AppError('No items specified for van loading.', 400);
    }

    return await prisma.$transaction(async (tx) => {
      await ensureDefaultLocations(tx);
      const vehicle = await resolveVehicleContext(vehicleId, tx);
      const username = user?.username || dto.repName || 'Warehouse Dispatcher';
      const movements = [];
      let lastVanItem = null;

      for (const item of rawItems) {
        const prodId = validatePositiveNumber(item.productId, 'Product ID');
        const qty = validatePositiveNumber(item.quantity, 'Load Quantity');

        const product = await tx.product.findUnique({
          where: { id: prodId },
        });
        if (!product || !product.isActive) {
          throw new AppError(`Product #${prodId} not found in active catalog.`, 404);
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
            lastUpdatedBy: username,
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
              lastUpdatedBy: username,
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
              lastUpdatedBy: username,
            },
          });
        }
        lastVanItem = vanItem;

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
            performedBy: username,
            notes: item.notes || dto.notes || 'Store-to-Vehicle transfer dispatch',
          },
        });

        movements.push(movement);
      }

      return {
        success: true,
        vanItem: lastVanItem,
        movements: movements.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
        movement: movements.length > 0 ? {
          ...movements[0],
          createdAt: movements[0].createdAt.toISOString(),
        } : null,
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
   * Supports both multi-item batch payload and single-item return.
   */
  async returnToWarehouse(dto: ReturnToStoreInput, user?: AuthenticatedUser) {
  const vehicleId = dto.vehicleId || 'VAN-01';

  // Normalize items to array (supports both multi-item and legacy single-item)
  const rawItems: Array<{ productId: any; quantity: any; reason?: string }> =
    Array.isArray(dto.items) && dto.items.length > 0
      ? dto.items
      : [{ productId: dto.productId, quantity: dto.quantity, reason: dto.reason }];

  if (rawItems.length === 0) {
    throw new AppError('No items specified for return to warehouse.', 400);
  }

  return await prisma.$transaction(async (tx) => {
    await ensureDefaultLocations(tx);
    const vehicle = await resolveVehicleContext(vehicleId, tx);
    const movements = [];

    for (const item of rawItems) {
      const prodId = validatePositiveNumber(item.productId, 'Product ID');
      const qty = validatePositiveNumber(item.quantity, 'Return Quantity');

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
          `Cannot return more than available on the van for ${vanItem?.productName || 'product'}. Available: ${available}, return quantity: ${qty}.`,
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
          lastUpdatedBy: user?.username || 'admin',
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
            lastUpdatedBy: user?.username || 'admin',
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
          performedBy: user?.username || dto.performedBy || vehicle.repName || 'Admin',
          notes: item.reason || dto.reason || dto.notes || 'Unsold stock returned to Central Warehouse',
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
      movement: movements.length > 0 ? {
        ...movements[0],
        createdAt: movements[0].createdAt.toISOString(),
      } : null,
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
  const reason = dto.reason?.trim() || dto.notes?.trim() || 'Damaged goods transfer';
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
  async updateDamagedStatus(id: number, dto: UpdateDamagedStatusInput, user ?: AuthenticatedUser) {
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

    const targetDate = targetManifest?.manifestDate || new Date();
    const nextRev = targetManifest ? targetManifest.manifestRevision + 1 : 1;
    const manifestNo = targetManifest ? generateManifestNo(targetDate, nextRev) : generateManifestNo(targetDate, 1);

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
          ownerSignedAt: targetDate,
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
          manifestDate: targetDate,
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
          ownerSignedAt: targetDate,
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
          ownerSignedAt: targetDate,
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
          manifestDate: targetDate,
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
          ownerSignedAt: targetDate,
          status: 'DISPATCHED',
          itemsSnapshot: itemsList as any,
          totalUnits,
          totalValue: Math.round(totalValue * 100) / 100,
        },
      });
    }

    // Persist owner signature to SystemSetting for future one-click re-use
    if (signatureData) {
      await tx.systemSetting.upsert({
        where: { key: 'owner_saved_signature' },
        update: { value: signatureData, updatedBy: user?.username || signer },
        create: { key: 'owner_saved_signature', value: signatureData, updatedBy: user?.username || signer },
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
   * Allows active item updates for DISPATCHED, PENDING, REP_ACCEPTED, or PARTIAL_DISCREPANCY.
   * Only blocks if manifest is strictly ARCHIVED, COMPLETED, or RETURNED.
   */
  async verifyManifestByRep(manifestNo?: string, dto: VerifyManifestByRepInput = {}) {
  const rawSignature = dto.repSignature || dto.signatureData || dto.signature;
  const repName = dto.repName?.trim() || 'Kamal Perera';
  const code = manifestNo?.trim() || dto.manifestNo?.trim();

  return await prisma.$transaction(async (tx) => {
    let manifest = null;
    if (code) {
      manifest = await tx.dailyVanManifest.findFirst({
        where: {
          OR: [{ manifestNo: code }, { id: code }],
        },
      });
    }
    if (!manifest) {
      let targetDate = new Date();
      if (dto.date) {
        const [y, m, d] = dto.date.split('-').map(Number);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          targetDate = new Date(y, m - 1, d, 12, 0, 0);
        }
      }
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      manifest = await tx.dailyVanManifest.findFirst({
        where: {
          vehicleId: dto.vehicleId || 'VAN-01',
          manifestDate: { gte: dayStart, lte: dayEnd },
        },
        orderBy: [{ manifestRevision: 'desc' }, { createdAt: 'desc' }],
      });
    }

    if (!manifest) {
      throw new AppError(`Manifest "${code || 'Daily'}" not found.`, 404);
    }

    // Relaxed Status Check: Allow active updates if manifest is DISPATCHED, PENDING, REP_ACCEPTED, or PARTIAL_DISCREPANCY.
    // Only block the update if the status is strictly ARCHIVED, COMPLETED, or RETURNED.
    const currentStatus = (manifest.status || '').toUpperCase();
    const blockedStatuses = ['ARCHIVED', 'COMPLETED', 'RETURNED'];
    if (blockedStatuses.includes(currentStatus)) {
      throw new AppError('This manifest is archived or already closed.', 400);
    }

    const effectiveSig = rawSignature || manifest.repSignatureData;
    if (!effectiveSig) {
      throw new AppError('Representative Signature is required.', 400);
    }
    const signatureData = validateSignatureDataUrl(effectiveSig, 'Representative Signature');

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

    let morningCheckedItems: string[] = [];
    if (Array.isArray(dto.morningCheckedItems)) {
      morningCheckedItems = dto.morningCheckedItems.map(String);
    } else if (dto.morningCheckedItems && typeof dto.morningCheckedItems === 'object') {
      morningCheckedItems = Object.keys(dto.morningCheckedItems).filter(
        (k) => Boolean(dto.morningCheckedItems[k])
      );
    } else {
      morningCheckedItems = vanItems
        .filter((item) => checkedItemMap.get(item.id))
        .map((item) => item.sku || String(item.productId || item.id));
    }

    const updatedManifest = await tx.dailyVanManifest.update({
      where: { id: manifest.id },
      data: {
        repSignatureData: signatureData,
        repSignedBy: repName,
        repSignedAt: manifest.manifestDate || now,
        status: finalStatus,
        uncheckedCount,
        morningCheckedItems: morningCheckedItems as any,
        itemsSnapshot: itemsList as any,
      },
    });

    // Persist sales rep signature to SystemSetting for future one-click re-use
    if (signatureData) {
      const repKey = manifest.salesPersonId
        ? `rep_saved_signature_${manifest.salesPersonId}`
        : (vehicle.salesPersonId ? `rep_saved_signature_${vehicle.salesPersonId}` : 'rep_saved_signature_default');
      await tx.systemSetting.upsert({
        where: { key: repKey },
        update: { value: signatureData, updatedBy: repName },
        create: { key: repKey, value: signatureData, updatedBy: repName },
      });
    }

    return {
      success: true,
      isFullVerification: uncheckedCount === 0,
      uncheckedCount,
      manifest: {
        ...updatedManifest,
        repSignature: updatedManifest.repSignatureData,
        morningCheckedItems,
        eveningCheckedItems: updatedManifest.eveningCheckedItems || [],
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
   * Retrieves saved digital signatures for Owner and Sales Rep from SystemSetting.
   */
  async getSavedSignatures(repId ?: string) {
  const ownerSetting = await prisma.systemSetting.findUnique({
    where: { key: 'owner_saved_signature' },
  });

  let repSetting = null;
  if (repId) {
    repSetting = await prisma.systemSetting.findUnique({
      where: { key: `rep_saved_signature_${repId}` },
    });
  }
  if (!repSetting) {
    // Check fallback default rep signature
    repSetting = await prisma.systemSetting.findUnique({
      where: { key: 'rep_saved_signature_default' },
    });
  }

  return {
    ownerSignature: ownerSetting?.value || null,
    repSignature: repSetting?.value || null,
  };
},

  /**
   * Directly saves or updates an Owner or Rep signature in SystemSetting.
   */
  async saveSignature(
  dto: { type: 'owner' | 'rep'; repId?: string; signatureData: string },
  user ?: AuthenticatedUser
) {
  const validData = validateSignatureDataUrl(dto.signatureData, `${dto.type === 'owner' ? 'Owner' : 'Rep'} Signature`);
  const key = dto.type === 'owner'
    ? 'owner_saved_signature'
    : (dto.repId ? `rep_saved_signature_${dto.repId}` : 'rep_saved_signature_default');

  const updated = await prisma.systemSetting.upsert({
    where: { key },
    update: { value: validData, updatedBy: user?.username || dto.type },
    create: { key, value: validData, updatedBy: user?.username || dto.type },
  });

  return { success: true, key: updated.key };
},

  /**
   * Immediately persists Morning Check or Evening Reconciliation Check to DB.
   */
  async toggleItemCheck(
    itemId: number,
    type: 'morning' | 'evening',
    checked: boolean,
    vehicleId: string = 'VAN-01',
    dateStr?: string
  ) {
    const vehicle = await resolveVehicleContext(vehicleId, prisma);
    const now = new Date();

    let targetDate = new Date();
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        targetDate = new Date(y, m - 1, d, 12, 0, 0);
      }
    }

    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const isToday = dayStart.toDateString() === new Date().toDateString();

    // 1. If morning check AND target date is today: update canonical StockItem directly
    if (type === 'morning' && isToday) {
      await prisma.stockItem.update({
        where: { id: itemId },
        data: {
          repChecked: checked,
          repCheckedAt: checked ? now : null,
          status: checked ? 'APPROVED' : 'PENDING_CONFIRMATION',
          discrepancyFlag: !checked,
        },
      });
    }

    // 2. Update target date's DailyVanManifest itemsSnapshot, morningCheckedItems, eveningCheckedItems
    let manifest = await prisma.dailyVanManifest.findFirst({
      where: {
        vehicleId,
        manifestDate: { gte: dayStart, lte: dayEnd },
      },
      orderBy: [{ manifestRevision: 'desc' }, { createdAt: 'desc' }],
    });

    if (manifest) {
      const targetItem = await prisma.stockItem.findUnique({
        where: { id: itemId },
        include: { product: true },
      });
      const sku = targetItem?.sku || targetItem?.product?.sku || '';
      const pidStr = targetItem?.productId ? String(targetItem.productId) : '';
      const idStr = String(itemId);

      let morningChecked: string[] = Array.isArray(manifest.morningCheckedItems)
        ? (manifest.morningCheckedItems as any[]).map(String)
        : [];
      let eveningChecked: string[] = Array.isArray(manifest.eveningCheckedItems)
        ? (manifest.eveningCheckedItems as any[]).map(String)
        : [];

      if (type === 'morning') {
        if (checked) {
          if (sku && !morningChecked.includes(sku)) morningChecked.push(sku);
          if (pidStr && !morningChecked.includes(pidStr)) morningChecked.push(pidStr);
          if (!morningChecked.includes(idStr)) morningChecked.push(idStr);
        } else {
          morningChecked = morningChecked.filter((x) => x !== sku && x !== pidStr && x !== idStr);
        }
      } else if (type === 'evening') {
        if (checked) {
          if (sku && !eveningChecked.includes(sku)) eveningChecked.push(sku);
          if (pidStr && !eveningChecked.includes(pidStr)) eveningChecked.push(pidStr);
          if (!eveningChecked.includes(idStr)) eveningChecked.push(idStr);
        } else {
          eveningChecked = eveningChecked.filter((x) => x !== sku && x !== pidStr && x !== idStr);
        }
      }

      let uncheckedCount = 0;
      let updatedSnapshot = manifest.itemsSnapshot;
      if (Array.isArray(manifest.itemsSnapshot)) {
        updatedSnapshot = (manifest.itemsSnapshot as any[]).map((snap) => {
          if (snap.id === itemId || (targetItem?.productId && snap.productId === targetItem.productId)) {
            const updated = {
              ...snap,
              repChecked: type === 'morning' ? checked : (snap.repChecked ?? false),
              eveningReconciled: type === 'evening' ? checked : (snap.eveningReconciled ?? false),
            };
            if (!updated.repChecked) uncheckedCount += 1;
            return updated;
          }
          if (!snap.repChecked) uncheckedCount += 1;
          return snap;
        });
      }

      await prisma.dailyVanManifest.update({
        where: { id: manifest.id },
        data: {
          itemsSnapshot: updatedSnapshot as any,
          uncheckedCount,
          morningCheckedItems: morningChecked as any,
          eveningCheckedItems: eveningChecked as any,
        },
      });
    }

    return {
      success: true,
      itemId,
      type,
      checked,
      date: dateStr || dayStart.toISOString().slice(0, 10),
    };
  },

  /**
   * Persists the evening reconciliation checklist items for the specified date and vehicle.
   */
  async saveEveningChecks(dto: ReconcileEveningChecksInput) {
    const vehicleId = dto.vehicleId || 'VAN-01';
    let targetDate = new Date();
    if (dto.date) {
      const [y, m, d] = dto.date.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        targetDate = new Date(y, m - 1, d, 12, 0, 0);
      }
    }

    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    let eveningCheckedItems: string[] = [];
    if (Array.isArray(dto.eveningCheckedItems)) {
      eveningCheckedItems = dto.eveningCheckedItems.map(String);
    } else if (dto.eveningCheckedItems && typeof dto.eveningCheckedItems === 'object') {
      eveningCheckedItems = Object.keys(dto.eveningCheckedItems).filter(
        (k) => Boolean(dto.eveningCheckedItems[k])
      );
    }

    return await prisma.$transaction(async (tx) => {
      let manifest = null;
      if (dto.manifestNo) {
        manifest = await tx.dailyVanManifest.findFirst({
          where: {
            OR: [{ manifestNo: dto.manifestNo }, { id: dto.manifestNo }],
          },
        });
      }
      if (!manifest) {
        manifest = await tx.dailyVanManifest.findFirst({
          where: {
            vehicleId,
            manifestDate: { gte: dayStart, lte: dayEnd },
          },
          orderBy: [{ manifestRevision: 'desc' }, { createdAt: 'desc' }],
        });
      }

      if (!manifest) {
        manifest = await tx.dailyVanManifest.create({
          data: {
            manifestNo: generateManifestNo(targetDate, 1),
            manifestDate: targetDate,
            vehicleId,
            status: 'DRAFT',
            eveningCheckedItems: eveningCheckedItems as any,
          },
        });
      } else {
        let updatedSnapshot = manifest.itemsSnapshot;
        if (Array.isArray(manifest.itemsSnapshot)) {
          updatedSnapshot = (manifest.itemsSnapshot as any[]).map((snap) => {
            const isReconciled =
              eveningCheckedItems.includes(snap.sku) ||
              eveningCheckedItems.includes(String(snap.id)) ||
              eveningCheckedItems.includes(String(snap.productId));
            return {
              ...snap,
              eveningReconciled: isReconciled,
              eveningReconciledAt: isReconciled ? new Date().toISOString() : null,
            };
          });
        }

        manifest = await tx.dailyVanManifest.update({
          where: { id: manifest.id },
          data: {
            eveningCheckedItems: eveningCheckedItems as any,
            itemsSnapshot: updatedSnapshot as any,
          },
        });
      }

      return {
        success: true,
        manifestNo: manifest.manifestNo,
        date: dto.date || dayStart.toISOString().slice(0, 10),
        eveningCheckedItems,
        manifest: {
          ...manifest,
          manifestDate: manifest.manifestDate.toISOString(),
          ownerSignedAt: manifest.ownerSignedAt ? manifest.ownerSignedAt.toISOString() : null,
          repSignedAt: manifest.repSignedAt ? manifest.repSignedAt.toISOString() : null,
          createdAt: manifest.createdAt.toISOString(),
          updatedAt: manifest.updatedAt.toISOString(),
        },
      };
    });
  },
};

export default VanStockService;
