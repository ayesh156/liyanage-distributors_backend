import type { Request, Response } from 'express';
import { StoreService } from '../services/store.service.ts';
import { catchAsync } from '../utils/catchAsync.ts';

export const StoreController = {
  /**
   * GET /api/stores
   * Query params: search, route, page, limit
   * Returns list of stores including related route details and routeId.
   */
  list: catchAsync(async (req: Request, res: Response) => {
    const query = {
      search: req.query.search as string | undefined,
      route: req.query.route as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await StoreService.getAll(query);

    // Ensure store records expose routeId and complete route relation object
    const mappedStores = (result.data || []).map((store: any) => {
      const routeName =
        (typeof store.route === 'object' && store.route !== null ? store.route.name : null) ||
        (typeof store.route === 'string' && store.route.trim() !== '' ? store.route.trim() : null) ||
        store.routeName ||
        'Unassigned Route';

      return {
        ...store,
        routeId: store.routeId ?? (typeof store.route === 'object' && store.route !== null ? store.route.id : null),
        route: store.route ?? routeName,
        routeName,
      };
    });

    res.status(200).json({
      success: true,
      data: mappedStores,
      pagination: result.pagination,
    });
  }),

  /**
   * GET /api/stores/routes
   * List all unique delivery routes.
   */
  listRoutes: catchAsync(async (_req: Request, res: Response) => {
    const routes = await StoreService.listRoutes();
    res.status(200).json({ success: true, data: routes });
  }),

  /**
   * GET /api/stores/:id
   * Retrieves full store details, active relational route, assigned sales rep, and invoices.
   */
  getById: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const store: any = await StoreService.getById(id);

    const routeName =
      (typeof store?.route === 'object' && store?.route !== null ? store?.route?.name : null) ||
      (typeof store?.route === 'string' && store?.route.trim() !== '' ? store?.route.trim() : null) ||
      store?.routeName ||
      'Unassigned Route';

    const normalizedStore = store
      ? {
          ...store,
          routeId: store.routeId ?? (typeof store.route === 'object' && store.route !== null ? store.route.id : null),
          route: store.route ?? routeName,
          routeName,
        }
      : store;

    res.status(200).json({ success: true, data: normalizedStore });
  }),

  /**
   * POST /api/stores
   * Creates a store and associates it with the provided routeId.
   */
  create: catchAsync(async (req: Request, res: Response) => {
    const { routeId, salesPersonId, ...rest } = req.body as any;
    const store = await StoreService.create({
      ...rest,
      routeId: routeId !== undefined ? (routeId === '' || routeId === null ? null : Number(routeId)) : undefined,
      salesPersonId,
    });
    res.status(201).json({ success: true, data: store, ...store });
  }),

  /**
   * PUT /api/stores/:id
   * Updates store details, correctly updating routeId relational foreign key.
   */
  update: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { routeId, salesPersonId, ...rest } = req.body as any;
    const store = await StoreService.update(id, {
      ...rest,
      ...(routeId !== undefined
        ? { routeId: routeId === '' || routeId === null ? null : Number(routeId) }
        : {}),
      salesPersonId,
    });
    res.status(200).json({ success: true, data: store, ...store });
  }),

  /**
   * DELETE /api/stores/:id
   */
  delete: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await StoreService.delete(id);
    res.status(200).json({ success: true, message: 'Store deleted successfully' });
  }),
};
