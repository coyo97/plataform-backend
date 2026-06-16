// src/routes/subject.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { SubjectModel } from './schemas/subject';
import { UserModel } from './schemas/user';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { dynamicPermissionMiddleware } from '../middlware/permissionMiddleware';

// helpers de tipo muy básicos
type AnyUser = any;

function isGlobalAdmin(user: AnyUser): boolean {
	// Ajusta esto a tu esquema de roles real
	const roleNames = (user?.roles || []).map((r: any) =>
		(String(r?.name || r?.role || '')).toLowerCase()
	);
	return roleNames.includes('admin') || roleNames.includes('admi') || roleNames.includes('super_admin');
}

// Obtiene usuario actual desde req (ajusta según tu authMiddleware)
async function getCurrentUser(req: Request, app: App): Promise<AnyUser | null> {
	// Muchas veces guardamos userId en req.userId o req.user._id
	const rawUserId =
		(req as any).userId ||
		(req as any).user?._id ||
		(req as any).auth?.userId;

	if (!rawUserId) return null;

	const User = UserModel(app.getClientMongoose());
	return User.findById(rawUserId).populate('roles').exec();
}

export class SubjectController {
	private route: string;
	private app: App;
	private model: ReturnType<typeof SubjectModel>;

	constructor(app: App, prefix: string) {
		this.route = `${prefix}/subjects`;
		this.app = app;
		this.model = SubjectModel(this.app.getClientMongoose());
		this.init();
	}

	private init() {
		const s = this.app.getAppServer();

		s.post(
			this.route,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.create.bind(this)
		);

		s.get(
			this.route,
			authMiddleware,
			this.list.bind(this)
		);

		s.put(
			`${this.route}/:id`,
			authMiddleware,
			this.update.bind(this)
		);
		s.delete(
			`${this.route}/:id`,
			authMiddleware,
			this.remove.bind(this)
		);
	}

	private async create(req: Request, res: Response) {
		try {
			const user = await getCurrentUser(req, this.app);
			if (!user) {
				return res
					.status(StatusCodes.UNAUTHORIZED)
					.json({ message: 'No autenticado' });
			}

			const isAdmin = isGlobalAdmin(user);
			const userCareerIds = (user.careers || []).map((c: any) => String(c));

			const bodyCareerIds: string[] = (req.body.careerIds || []).map((id: any) =>
				String(id)
			);

			if (!isAdmin) {
				const allAllowed = bodyCareerIds.every((id) =>
					userCareerIds.includes(id)
				);
				if (!allAllowed) {
					return res.status(StatusCodes.FORBIDDEN).json({
						message:
							'No puedes crear materias en carreras que no te pertenecen',
					});
				}
			}

			const subject = await this.model.create(req.body);
			return res.status(StatusCodes.CREATED).json({ subject });
		} catch (e) {
			return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'Error', e });
		}
	}

private async list(req: Request, res: Response) {
	try {
		const user = await getCurrentUser(req, this.app);
		const isAdmin = user ? isGlobalAdmin(user) : false;

		const userCareerIds = user
			? (user.careers || []).map((c: any) => String(c))
			: [];

		const { careerId } = req.query as { careerId?: string };

		const q: any = {};

		// Filtro directo por careerId si viene en query
		if (careerId) {
			q.careerIds = careerId;
		}

		/**
		 * Regla de negocio:
		 * - Si NO es admin y NO se especifica careerId:
		 *   -> por defecto solo ve materias de sus carreras.
		 * - Si se especifica careerId explícitamente:
		 *   -> NO bloqueamos aunque no esté en sus carreras (permite
		 *      que Ayuda Académica consulte materias de otras carreras).
		 */
		if (user && !isAdmin && !careerId) {
			if (userCareerIds.length > 0) {
				q.careerIds = { $in: userCareerIds };
			} else {
				// Sin carreras asociadas: opcionalmente podrías devolver vacío
				// q.careerIds = { $in: [] };
			}
		}

		const subjects = await this.model
			.find(q)
			.sort({ code: 1 })
			.exec();

		return res.status(StatusCodes.OK).json({ subjects });
	} catch (error) {
		console.error('Error al listar materias:', error);
		return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al listar las materias', error });
	}
}


	private async update(req: Request, res: Response) {
		const user = await getCurrentUser(req, this.app);
		if (!user) {
			return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
		}
		const isAdmin = isGlobalAdmin(user);
		const userCareerIds = (user.careers || []).map((c: any) => String(c));

		// Cargamos la materia actual
		const current = await this.model.findById(req.params.id).exec();
		if (!current) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Materia no encontrada' });
		}

		if (!isAdmin) {
			const subjectCareerIds = (current.careerIds || []).map((id: any) =>
				String(id)
			);
			const hasIntersection = subjectCareerIds.some((id) =>
				userCareerIds.includes(id)
			);
			if (!hasIntersection) {
				return res.status(StatusCodes.FORBIDDEN).json({
					message: 'No puedes modificar materias de otra carrera',
				});
			}
		}

		const subject = await this.model.findByIdAndUpdate(
			req.params.id,
			req.body,
			{ new: true }
		);
		return res.status(StatusCodes.OK).json({ subject });
	}

	private async remove(req: Request, res: Response) {
		const user = await getCurrentUser(req, this.app);
		if (!user) {
			return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
		}
		const isAdmin = isGlobalAdmin(user);
		const userCareerIds = (user.careers || []).map((c: any) => String(c));

		const current = await this.model.findById(req.params.id).exec();
		if (!current) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Materia no encontrada' });
		}

		if (!isAdmin) {
			const subjectCareerIds = (current.careerIds || []).map((id: any) =>
				String(id)
			);
			const hasIntersection = subjectCareerIds.some((id) =>
				userCareerIds.includes(id)
			);
			if (!hasIntersection) {
				return res.status(StatusCodes.FORBIDDEN).json({
					message: 'No puedes eliminar materias de otra carrera',
				});
			}
		}

		await this.model.findByIdAndDelete(req.params.id);
		return res
			.status(StatusCodes.OK)
			.json({ message: 'Eliminado' });
	}
}

