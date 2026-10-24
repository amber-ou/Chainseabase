import { handleApiRequest } from '@/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handleApiRequest(req);
export const POST = (req: Request) => handleApiRequest(req);
export const PATCH = (req: Request) => handleApiRequest(req);
export const PUT = (req: Request) => handleApiRequest(req);
export const DELETE = (req: Request) => handleApiRequest(req);
