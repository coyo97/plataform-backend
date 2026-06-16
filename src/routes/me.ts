// src/routes/me.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { UserModel } from './schemas/user';
import { RoleModel } from './schemas/role';

// Tipos flexibles para permissions poblados
type PopulatedNameObj = { name?: string };
type PopulatedPermission =
  | { module?: PopulatedNameObj | string; action?: PopulatedNameObj | string }
  | { moduleName?: string; actionName?: string }
  | { module_name?: string; action_name?: string }
  | any;

type AuthRequest = Request & { userId?: string };

function extractName(x: any): string | null {
  if (!x) return null;
  if (typeof x === 'string') return x.toLowerCase().trim();
  if (typeof x === 'object') {
    const candidate =
      x.name ?? x.nombre ?? x.label ?? x.slug ?? x.code ?? x.key ?? null;
    if (typeof candidate === 'string') return candidate.toLowerCase().trim();
  }
  return null;
}

export class MeController {
  private route: string;
  private app: App;

  constructor(app: App, route: string) {
    this.app = app;
    this.route = route;
    this.initRoutes();
  }

  private initRoutes() {
    this.app.getAppServer().get(
      `${this.route}/me/permissions`,
      authMiddleware,
      this.getMyPermissions.bind(this),
    );
  }

  private async getMyPermissions(req: AuthRequest, res: Response): Promise<Response> {
    try {
      if (!req.userId) {
        return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'No autenticado' });
      }

      const User = UserModel(this.app.getClientMongoose());
      const Role = RoleModel(this.app.getClientMongoose());

      // Traer al usuario con roles (no hace falta populate aquí)
      const me = await User.findById(req.userId).lean().exec();
      if (!me) {
        return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no encontrado' });
      }

      // Extraer ids y/o names de roles de forma robusta
      const roleIds: string[] = [];
      const roleNames: string[] = [];
      for (const r of (me as any).roles ?? []) {
        if (!r) continue;
        if (typeof r === 'string') { roleIds.push(r); continue; }
        if (typeof r === 'object') {
          if (r._id) roleIds.push(String(r._id));
          if (r.name) roleNames.push(String(r.name));
          continue;
        }
      }

      // Query OR por _id o name (según lo que tengas)
      const roleQuery: any = {};
      const ors: any[] = [];
      if (roleIds.length)  ors.push({ _id: { $in: roleIds } });
      if (roleNames.length) ors.push({ name: { $in: roleNames } });
      if (ors.length === 0) {
        return res.status(StatusCodes.OK).json({ permissions: [] });
      }
      roleQuery.$or = ors;

      // Traer roles con permissions poblados (solo 'name' de module y action)
      const roles = await Role.find(roleQuery)
        .populate({
          path: 'permissions',
          select: 'module action', // opcional
          populate: [
            { path: 'module', select: 'name' },
            { path: 'action', select: 'name' },
          ],
        })
        .lean()
        .exec();

      const perms = new Set<string>();
      for (const r of roles) {
        const arr: PopulatedPermission[] = (r as any).permissions ?? [];
        for (const p of arr) {
          const mod =
            extractName((p as any).module) ??
            extractName((p as any).moduleName) ??
            extractName((p as any).module_name);

          const act =
            extractName((p as any).action) ??
            extractName((p as any).actionName) ??
            extractName((p as any).action_name);

          if (mod && act) perms.add(`${mod}:${act}`);
        }
      }

      return res.status(StatusCodes.OK).json({ permissions: Array.from(perms) });
    } catch (err) {
      console.error('Error en /me/permissions:', err);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener permisos' });
    }
  }
}

