import type { Request, Response } from 'express';
import { StoreService } from '../services/store.service.ts';
import { catchAsync } from '../utils/catchAsync.ts';

export const StoreController = {
  /**
   * GET /api/stores
   * Query params: search, route, page, limit
   */
  list: catchAsync(async (req: Request, res: Response) => {
    const query = {
      search: req.query.search as string | undefined,
      route: req.query.route as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await StoreService.getAll(query);

    // Map store records with fallback route name to prevent "Unassigned Route" in UI
    const mappedStores = (result.data || []).map((store: any) => {
      const resolvedRoute =
        (typeof store.route === 'object' && store.route !== null ? store.route.name : null) ||
        (typeof store.route === 'string' && store.route.trim() !== '' ? store.route.trim() : null) ||
        store.routeName ||
        'Unassigned Route';

      return {
        ...store,
        route: resolvedRoute,
        routeName: resolvedRoute,
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
   */
  getById: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const store: any = await StoreService.getById(id);

    // Normalize route field to plain string name for UI headers
    const resolvedRoute =
      (typeof store?.route === 'object' && store?.route !== null ? store?.route?.name : null) ||
      (typeof store?.route === 'string' && store?.route.trim() !== '' ? store?.route.trim() : null) ||
      store?.routeName ||
      'Unassigned Route';

    const normalizedStore = store
      ? {
          ...store,
          route: resolvedRoute,
          routeName: resolvedRoute,
        }
      : store;

    res.status(200).json({ success: true, data: normalizedStore });
  }),

  /**
   * POST /api/stores
   */
  create: catchAsync(async (req: Request, res: Response) => {
    const { salesPersonId, ...rest } = req.body as any;
    const store = await StoreService.create({ ...rest, salesPersonId });
    res.status(201).json({ success: true, data: store, ...store });
  }),

  /**
   * PUT /api/stores/:id
   */
  update: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { salesPersonId, ...rest } = req.body as any;
    const store = await StoreService.update(id, { ...rest, salesPersonId });
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