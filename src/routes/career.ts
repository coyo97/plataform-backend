// src/routes/career.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CareerModel, ICareer } from './schemas/career'; 
import { UserModel } from './schemas/user';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

async function getCurrentUser(req: Request, app: App) {
	const rawUserId =
		(req as any).userId ||
		(req as any).user?._id ||
		(req as any).auth?.userId;

	if (!rawUserId) return null;

	const User = UserModel(app.getClientMongoose());
	return User.findById(rawUserId).exec();
}

export class CareerController {
	private route: string;
	private app: App;
	private careerModel: ReturnType<typeof CareerModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.careerModel = CareerModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {
		const srv = this.app.getAppServer();

		srv.post(
			`${this.route}/careers`,
			authMiddleware,
			this.createCareer.bind(this)
		);

		srv.get(
			`${this.route}/careers`,
			this.listCareers.bind(this)
		);

		srv.put(
			`${this.route}/careers/:id`,
			authMiddleware,
			this.updateCareer.bind(this)
		);

		srv.delete(
			`${this.route}/careers/:id`,
			authMiddleware,
			this.deleteCareer.bind(this)
		);
	}

	private async createCareer(req: Request, res: Response): Promise<Response> {
		try {
			const { name, description, facultyId } = req.body;
			const newCareer = new this.careerModel({ name, description, facultyId });
			const result = await newCareer.save();
			return res.status(StatusCodes.CREATED).json({ career: result });
		} catch (error) {
			console.error('Error al crear la carrera:', error);
			return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'Error al crear la carrera', error });
		}
	}

	private async listCareers(req: Request, res: Response): Promise<Response> {
		try {
			const { scope } = req.query;

			if (scope === 'my') {
				const user = await getCurrentUser(req, this.app);
				if (!user) {
					return res
						.status(StatusCodes.UNAUTHORIZED)
						.json({ message: 'No autenticado' });
				}

				const ids = (user.careers || []).map((id: any) => String(id));
				if (!ids.length) {
					return res.status(StatusCodes.OK).json({ careers: [] });
				}

				const careers = await this.careerModel
					.find({ _id: { $in: ids } })
					.populate('facultyId', 'name')
					.sort({ name: 1 })
					.exec();

				return res.status(StatusCodes.OK).json({ careers });
			}

			const careers = await this.careerModel
				.find()
				.populate('facultyId', 'name')
				.sort({ name: 1 })
				.exec();

			return res.status(StatusCodes.OK).json({ careers });
		} catch (error) {
			return res
				.status(StatusCodes.INTERNAL_SERVER_ERROR)
				.json({ message: 'Error al listar las carreras', error });
		}
	}

	private async updateCareer(req: Request, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const { name, description, facultyId } = req.body;
			const updatedCareer = await this.careerModel
				.findByIdAndUpdate(
					id,
					{ name, description, facultyId },
					{ new: true }
				)
				.exec();
			return res.status(StatusCodes.OK).json({ career: updatedCareer });
		} catch (error) {
			return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'Error al actualizar la carrera', error });
		}
	}

	private async deleteCareer(req: Request, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			await this.careerModel.findByIdAndDelete(id).exec();
			return res
				.status(StatusCodes.OK)
				.json({ message: 'Carrera eliminada correctamente' });
		} catch (error) {
			return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'Error al eliminar la carrera', error });
		}
	}
}

