import { Router, handleApi } from '../http';
import { registerIdentityRoutes } from './routes-identity';
import { registerProductRoutes } from './routes-products';
import { registerFeedbackRoutes } from './routes-feedback';
import { registerWorkRoutes } from './routes-work';
import { registerCalendarRoutes } from './routes-calendar';

let router: Router | null = null;

export function getRouter(): Router {
  if (!router) {
    router = new Router();
    registerIdentityRoutes(router);
    registerProductRoutes(router);
    registerFeedbackRoutes(router);
    registerWorkRoutes(router);
    registerCalendarRoutes(router);
  }
  return router;
}

export function handleApiRequest(req: Request): Promise<Response> {
  return handleApi(req, getRouter());
}
