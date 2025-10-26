// src/middlware/systemPermissionMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { SystemPermissionModel } from '../routes/schemas/systemPermission';
import mongoose from 'mongoose';

/**
 * Middleware para validar permisos entre módulos del sistema.
 * Ejemplo: el módulo "Ayuda Académica" puede acceder a "Publicaciones" (crear, leer, etc.).
 *
 * Se basa en una colección SystemPermission que define las relaciones permitidas entre módulos.
 *
 * Cada solicitud debe incluir encabezados personalizados:
 *   - x-origin-module : nombre del módulo de origen (quién solicita)
 *   - x-target-module : nombre del módulo de destino (a qué módulo accede)
 *
 * También se puede inferir automáticamente si defines estas relaciones en el backend.
 */
export async function systemPermissionMiddleware(
	req: Request,
	res: Response,
	next: NextFunction
): Promise<Response | void> {
	try {
		const originModule = (req.headers['x-origin-module'] as string)?.trim();
		const targetModule = (req.headers['x-target-module'] as string)?.trim();
		const method = req.method.toUpperCase();

		if (!originModule || !targetModule) {
			return res.status(StatusCodes.BAD_REQUEST).json({
				message: 'Faltan los encabezados requeridos: x-origin-module y x-target-module',
				example: {
					'x-origin-module': 'AyudaAcademica',
					'x-target-module': 'Publicaciones',
				},
			});
		}

		// Mapear método HTTP a acción
		const action = mapMethodToAction(method);

		// Buscar regla de permiso entre módulos
		const SystemPermission = SystemPermissionModel(mongoose);
		const rule = await SystemPermission.findOne({
			originModule,
			targetModule,
			enabled: true,
			actions: { $in: [action] },
		}).exec();

		if (!rule) {
			console.warn(
				`[SystemPermission] No se encontró permiso: ${originModule} → ${targetModule} [${action}]`
			);
			return res.status(StatusCodes.FORBIDDEN).json({
				message: `El módulo "${originModule}" no tiene permiso para realizar la acción "${action}" en "${targetModule}"`,
			});
		}

		console.log(
			`[SystemPermission] Permiso concedido: ${originModule} → ${targetModule} [${action}]`
		);

		next();
	} catch (error) {
		console.error('Error en systemPermissionMiddleware:', error);
		return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
			message: 'Error verificando permisos del sistema',
			error: error instanceof Error ? error.message : error,
		});
	}
}

/** Mapea los métodos HTTP a acciones semánticas */
const mapMethodToAction = (method: string): string => {
	const map: Record<string, string> = {
		GET: 'Read',
		POST: 'Create',
		PUT: 'Update',
		PATCH: 'Update',
		DELETE: 'Delete',
	};
	return map[method] || 'Unknown';
};

