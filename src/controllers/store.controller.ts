import { Request, Response } from 'express';
import { StoreService } from '../services/store.service.js';
import { catchAsync } from '../utils/catchAsync.js';

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

    res.status(200).json({
      success: true,
      data: result.data,
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
    const store = await StoreService.getById(id);
    res.status(200).json({ success: true, data: store });
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