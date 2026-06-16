// src/middlware/permissionMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';

// Modelos
import { UserModel } from '../routes/schemas/user';
import { CareerModel } from '../routes/schemas/career';
import { ModuleModel } from '../routes/schemas/module';
import { ActionModel } from '../routes/schemas/action';
import { AccessPolicyModel } from '../routes/schemas/accessPolicy';
import { TargetResolvers } from './targetResolvers';

/* ================= Tipos locales ================= */
interface AuthRequest extends Request {
	userId?: string;
	userPermissions?: Set<string>;
}

type Op = 'eq' | 'neq' | 'in' | 'not_in' | 'overlaps';
type Condition = { path: string; op: Op; value?: any };

type ActorCtx = {
	id?: string;
	careerIds: string[];
	facultyIds: string[];
	roleIds: string[];
};

type TargetCtx = {
	id?: string;
	careerIds: string[];
	facultyIds: string[];
};

type Ctx = {
	actor: ActorCtx;
	target: TargetCtx;
	resource?: Record<string, any>;
};

/* ================= Utils ================= */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const uniq = <T,>(arr: T[]) => Array.from(new Set((arr || []).filter(Boolean) as any)) as T[];

async function careersToFacultyIds(careerIds: string[]): Promise<string[]> {
	if (!careerIds?.length) return [];
	const Career = CareerModel(mongoose);
	const rows = await Career.find({ _id: { $in: careerIds } }, { facultyId: 1 }).lean().exec();
	const facs = rows.map((r: any) => (r?.facultyId ? String(r.facultyId) : null)).filter(Boolean) as string[];
	return uniq(facs);
}

function getPath(obj: any, path: string) {
	return path.split('.').reduce((acc, k) => acc?.[k], obj);
}
function toArr(v: any) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

/** Comparador de condiciones (mismo contrato que tu policyEvaluator) */
function match(cond: Condition, ctx: Ctx) {
	const leftRaw = getPath(ctx, cond.path);
	const rightRaw = cond.value;
	const L = toArr(leftRaw).map(String);
	const R = toArr(rightRaw).map(String);

	switch (cond.op) {
		case 'eq':       return L.length === 1 && R.length === 1 && L[0] === R[0];
		case 'neq':      return (L.length === 1 && R.length === 1) ? (L[0] !== R[0]) : true;
		case 'in':       return (L.length && R.length) ? L.some(x => R.includes(x)) : false;
		case 'not_in':   return (!L.length || !R.length) ? true : L.every(x => !R.includes(x));
		case 'overlaps': return (L.length && R.length) ? L.some(x => R.includes(x)) : false;
		default:         return false;
	}
}

function policyMatches(policy: any, ctx: Ctx): boolean {
	const groups: Array<'subject'|'target'|'resource'> = ['subject','target','resource'];
	return groups.every(g => (policy[g] ?? []).every((c: Condition) => match(c, ctx)));
}

/* ================= Inferencia de permiso ================= */
const inferPermission = (req: Request): string | null => {
	const method = req.method.toUpperCase();
	const fullPath = req.originalUrl;

	// Overrides para comments
	if (method === 'POST' && /\/comments$/.test(fullPath)) return 'Comments:Create';
	if (method === 'GET'  && /\/comments$/.test(fullPath)) return 'Comments:Read';

	// Limpiar querystring
	const urlWithoutQuery = fullPath.split('?')[0];

	// Segmentar ruta
	const pathSegments = urlWithoutQuery.split('/').filter(segment => !segment.startsWith(':') && segment !== '');
	const apiIndex = pathSegments.indexOf('api');
	if (apiIndex === -1 || apiIndex + 1 >= pathSegments.length) {
		console.warn('No se pudo determinar el módulo desde la ruta:', fullPath);
		return null;
	}

	const moduleName = capitalize(pathSegments[apiIndex + 1]);

	// HTTP -> Acción
	const actionMap: Record<string, string> = {
		GET: 'Read',
		POST: 'Create',
		PUT: 'Update',
		PATCH: 'Update',
		DELETE: 'Delete',
	};
	const actionName = actionMap[method];
	if (!actionName) return null;

	return `${moduleName}:${actionName}`;
};

/* ================= Helpers de colecciones ================= */
/** True si es GET /api/publications  (list, sin :id) */
function isPublicationsList(req: Request): boolean {
	if (req.method.toUpperCase() !== 'GET') return false;
	const path = req.originalUrl.split('?')[0];
	// Coincide /api/publications o /api/publications/
	const endsWithPublications = /\/api\/publications\/?$/.test(path);
	const isDetailParam = !!(req.params as any)?.id || !!(req.params as any)?.publicationId;
	return endsWithPublications && !isDetailParam;
}

/** Extrae carreras “scopables” desde policies deny (subject.actor.careerIds) */
function collectScopedCareersFromDeny(policies: any[]): Set<string> {
	const scoped = new Set<string>();
	for (const p of (policies || [])) {
		if (p.effect !== 'deny') continue;
		const subjectConds: Condition[] = p.subject || [];
		for (const c of subjectConds) {
			if (c.path !== 'actor.careerIds') continue;
			if (!['overlaps', 'in', 'eq'].includes(c.op)) continue;
			const vals = toArr(c.value).map(String);
			for (const v of vals) scoped.add(v);
		}
	}
	return scoped;
}

/* ================= Middleware RBAC + validación contextual ================= */
export const dynamicPermissionMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
	try {
		// Debe venir precargado (tu auth middleware lo hace)
		if (!req.userPermissions) {
			res.status(StatusCodes.FORBIDDEN).json({ message: 'No se cargaron los permisos del usuario' });
			return;
		}

		// 1) Inferir permiso
		const requiredPermission = inferPermission(req);
		if (!requiredPermission) { next(); return; }

		// 2) RBAC clásico
		if (!req.userPermissions.has(requiredPermission)) {
			res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para realizar esta acción' });
			return;
		}

		// 3) Cargar definiciones Módulo/Acción (si no existen, no alteramos nada)
		const [modName, actName] = requiredPermission.split(':');
		const Module = ModuleModel(mongoose);
		const Action = ActionModel(mongoose);
		const AccessPolicy = AccessPolicyModel(mongoose);

		const [mod, act] = await Promise.all([
			Module.findOne({ name: modName }).lean().exec(),
			Action.findOne({ name: actName }).lean().exec(),
		]);

		// 4) Actor (derivar faculties y roles como listas de strings)
		const User = UserModel(mongoose);
		const me = await User.findById(req.userId).populate('careers').populate('roles').lean().exec();

		const actorCareerIds = uniq((me?.careers ?? []).map((c: any) => String(c?._id ?? c)));
		const actorFacultyIds = await careersToFacultyIds(actorCareerIds);
		const actorRoleIds = uniq((me?.roles ?? []).map((r: any) => String(r?._id ?? r)));

		const actor: ActorCtx = {
			id: me?._id ? String(me._id) : undefined,
			careerIds: actorCareerIds,
			facultyIds: actorFacultyIds,
			roleIds: actorRoleIds,
		};

		// Si no hay módulo/acción en DB, no aplicamos políticas contextuales
		if (!mod || !act) { next(); return; }

		const policies = await AccessPolicy.find({
			module: mod._id,
			action: act._id,
			enabled: true
		}).lean().exec();

		/* ===== Bloque de colecciones: Publications:Read =====
Objetivo: solo “scopear” a actores mencionados en policies deny (p.ej., Sistemas).
- Si el actor pertenece a una carrera “scopable”, exigimos/inyectamos ?careerId=<propio>
- Si NO pertenece (p.ej., Minas), no exigimos careerId → ve todo (controller define el resto).
		 */
		if (requiredPermission === 'Publications:Read' && isPublicationsList(req) && policies?.length) {
			// Admin bypass opcional:
			// const isAdmin = actorRoleIds.includes('<roleId_admin>');
			// if (isAdmin) { next(); return; }

			const scopedCareers = collectScopedCareersFromDeny(policies);
			const actorIsScoped = actor.careerIds.some(id => scopedCareers.has(id));

			if (actorIsScoped) {
				if (!actor.careerIds.length) {
					res.status(StatusCodes.FORBIDDEN).json({ message: 'Tu usuario no tiene carreras asociadas' });
					return;
				}
				const q = req.query as any;
				let requestedCareerId = typeof q?.careerId === 'string' ? q.careerId : undefined;

		// Sin careerId o "all" ⇒ fallback a la primera carrera del actor (no tocamos controllers)
		if (!requestedCareerId || requestedCareerId === 'all') {
			(req.query as any).careerId = actor.careerIds[0];
			requestedCareerId = actor.careerIds[0];
		}

		// Validar pertenencia
		if (!actor.careerIds.includes(String(requestedCareerId))) {
			res.status(StatusCodes.FORBIDDEN).json({ message: 'No puedes listar publicaciones de una carrera que no te pertenece' });
			return;
		}
	}
	// Si NO es actor “scopable”, no forzamos careerId: controller se queda como está (ve todo)
}
/* ===== Fin bloque colecciones ===== */

// Si no hay policies, no hay más que hacer
if (!policies?.length) { next(); return; }

// 5) Resolver target (para operaciones con :id) y evaluar policies
const resolver = TargetResolvers[requiredPermission];
const t = resolver ? await resolver(req) : undefined;
const target: TargetCtx = {
	id: t?.id,
	careerIds: uniq((t?.careerIds ?? []).map(String)),
	facultyIds: uniq((t?.facultyIds ?? []).map(String)),
};

const ctx: Ctx = { actor, target };

// DENY gana
const someDeny = policies.some(p => p.effect === 'deny' && policyMatches(p, ctx));
if (someDeny) {
	res.status(StatusCodes.FORBIDDEN).json({ message: 'Acceso denegado por política' });
	return;
}

// Si hay ALLOW, alguna debe matchear
const hasAllow = policies.some(p => p.effect === 'allow');
if (hasAllow) {
	const allowed = policies.some(p => p.effect === 'allow' && policyMatches(p, ctx));
	if (!allowed) {
		res.status(StatusCodes.FORBIDDEN).json({ message: 'Política no permite esta operación' });
		return;
	}
}

// OK
next();
return;
  } catch (err) {
	  console.error('Error en dynamicPermissionMiddleware (ABAC overlay):', err);
	  // Por resiliencia, si algo falla aquí, no bloqueamos a quien ya pasó RBAC
	  next();
	  return;
  }
};

