// src/routes/unit.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnitModel } from './schemas/unit';
import { SubjectModel } from './schemas/subject';
import { UserModel } from './schemas/user';     
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { dynamicPermissionMiddleware } from '../middlware/permissionMiddleware';

type AnyUser = any;

function isGlobalAdmin(user: AnyUser): boolean {
	const roleNames = (user?.roles || []).map((r: any) =>
		(String(r?.name || r?.role || '')).toLowerCase()
	);
	return roleNames.includes('admin') || roleNames.includes('admi') || roleNames.includes('super_admin');
}

async function getCurrentUser(req: Request, app: App): Promise<AnyUser | null> {
	const rawUserId =
		(req as any).userId ||
		(req as any).user?._id ||
		(req as any).auth?.userId;

	if (!rawUserId) return null;

	const User = UserModel(app.getClientMongoose());
	return User.findById(rawUserId).populate('roles').exec();
}

export class UnitController {
	private route: string;
	private app: App;
	private model: ReturnType<typeof UnitModel>;
	private subjectModel: ReturnType<typeof SubjectModel>;

	constructor(app: App, prefix: string) {
		this.route = `${prefix}/units`;
		this.app = app;
		this.model = UnitModel(this.app.getClientMongoose());
		this.subjectModel = SubjectModel(this.app.getClientMongoose());
		this.init();
	}

	private init() {
		const srv = this.app.getAppServer();
		srv.post(
			this.route,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.create.bind(this)
		);
		srv.get(this.route, this.list.bind(this));

		srv.put(
			`${this.route}/:id`,
			authMiddleware,
			this.update.bind(this)
		);
		srv.delete(
			`${this.route}/:id`,
			authMiddleware,
			this.remove.bind(this)
		);
	}

	private async create(req: Request, res: Response) {
		const user = await getCurrentUser(req, this.app);
		if (!user) {
			return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
		}
		const isAdmin = isGlobalAdmin(user);
		const userCareerIds = (user.careers || []).map((c: any) => String(c));

		const { subjectId } = req.body;
		if (!subjectId) {
			return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'subjectId es requerido' });
		}

		const subject = await this.subjectModel.findById(subjectId).exec();
		if (!subject) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Materia no encontrada' });
		}

		if (!isAdmin) {
			const subjectCareerIds = (subject.careerIds || []).map((id: any) =>
				String(id)
			);
			const hasIntersection = subjectCareerIds.some((id) =>
				userCareerIds.includes(id)
			);
			if (!hasIntersection) {
				return res.status(StatusCodes.FORBIDDEN).json({
					message:
						'No puedes crear unidades para materias de otra carrera',
				});
			}
		}

		const unit = await this.model.create(req.body);
		return res.status(StatusCodes.CREATED).json({ unit });
	}

	private async list(req: Request, res: Response) {
		const { subjectId } = req.query;
		const q: any = subjectId ? { subjectId } : {};
		const units = await this.model.find(q).sort({ week: 1 }).exec();
		return res.status(StatusCodes.OK).json({ units });
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

		const unit = await this.model.findById(req.params.id).exec();
		if (!unit) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Unidad no encontrada' });
		}

		const subject = await this.subjectModel
			.findById(unit.subjectId)
			.exec();
		if (!subject) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Materia asociada no encontrada' });
		}

		if (!isAdmin) {
			const subjectCareerIds = (subject.careerIds || []).map((id: any) =>
				String(id)
			);
			const hasIntersection = subjectCareerIds.some((id) =>
				userCareerIds.includes(id)
			);
			if (!hasIntersection) {
				return res.status(StatusCodes.FORBIDDEN).json({
					message:
						'No puedes modificar unidades de materias de otra carrera',
				});
			}
		}

		const updated = await this.model.findByIdAndUpdate(
			req.params.id,
			req.body,
			{ new: true }
		);
		return res.status(StatusCodes.OK).json({ unit: updated });
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

		const unit = await this.model.findById(req.params.id).exec();
		if (!unit) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Unidad no encontrada' });
		}

		const subject = await this.subjectModel
			.findById(unit.subjectId)
			.exec();
		if (!subject) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Materia asociada no encontrada' });
		}

		if (!isAdmin) {
			const subjectCareerIds = (subject.careerIds || []).map((id: any) =>
				String(id)
			);
			const hasIntersection = subjectCareerIds.some((id) =>
				userCareerIds.includes(id)
			);
			if (!hasIntersection) {
				return res.status(StatusCodes.FORBIDDEN).json({
					message:
						'No puedes eliminar unidades de materias de otra carrera',
				});
			}
		}

		await this.model.findByIdAndDelete(req.params.id);
		return res
			.status(StatusCodes.OK)
			.json({ message: 'Eliminado' });
	}
}

