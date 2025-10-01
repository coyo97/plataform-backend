// src/middlware/permissionMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UserModel } from '../routes/schemas/user';
import App from '../app';

interface AuthRequest extends Request {
	userId?: string;
	userPermissions?: Set<string>;
}
interface Module {
	name: string;
}

interface Action {
	name: string;
}

interface Permission {
	module: Module;
	action: Action;
}

interface Role {
	permissions: Permission[];
}

interface User {
	roles: Role[];
}


export const dynamicPermissionMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
	if (!req.userPermissions) {
		return res.status(StatusCodes.FORBIDDEN).json({ message: 'No se cargaron los permisos del usuario' });
	}

	// Inferir el permiso requerido
	const requiredPermission = inferPermission(req);
	console.log('Permiso requerido:', requiredPermission);

	if (!requiredPermission) {
		// Si no se pudo inferir un permiso, se permite el acceso (comportamiento actual)
		return next();
	}

	if (req.userPermissions.has(requiredPermission)) {
		return next();
	} else {
		console.warn(`Permiso '${requiredPermission}' no encontrado en los permisos del usuario.`);
		return res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para realizar esta acción' });
	}
};

// Función para inferir el permiso requerido
const inferPermission = (req: Request): string | null => {
	const method = req.method.toUpperCase();
	const fullPath = req.originalUrl; // URL completa solicitada

	// --- OVERRIDE SOLO PARA COMMENTS (READ Y CREATE) ---
	// POST /.../publications/:id/comments   -> Comments:Create
	// GET  /.../publications/:id/comments   -> Comments:Read
	if (method === 'POST' && /\/comments$/.test(fullPath)) {
		return 'Comments:Create';
	}
	if (method === 'GET' && /\/comments$/.test(fullPath)) {
		return 'Comments:Read';
	}
	// --- FIN OVERRIDE COMMENTS ---

	// Remover query parameters
	const urlWithoutQuery = fullPath.split('?')[0];

	// Dividir en segmentos
	const pathSegments = urlWithoutQuery.split('/').filter(segment => !segment.startsWith(':') && segment !== '');

	// Encontrar el índice del segmento 'api' y tomar el siguiente como el módulo
	const apiIndex = pathSegments.indexOf('api');
	if (apiIndex === -1 || apiIndex + 1 >= pathSegments.length) {
		console.warn('No se pudo determinar el módulo desde la ruta:', fullPath);
		return null;
	}

	const moduleName = capitalize(pathSegments[apiIndex + 1]); // Segmento después de 'api'

	// Mapear el método HTTP a una acción
	const actionMap: Record<string, string> = {
		GET: 'Read',
		POST: 'Create',
		PUT: 'Update',
		PATCH: 'Update',
		DELETE: 'Delete',
	};

	const actionName = actionMap[method];

	if (!actionName) {
		// Método HTTP no soportado
		return null;
	}

	// Construir el nombre del permiso
	const permission = `${moduleName}:${actionName}`;

	console.log(`Inferido permiso requerido: ${permission}`);
	return permission;
};

// Función auxiliar para capitalizar la primera letra
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

