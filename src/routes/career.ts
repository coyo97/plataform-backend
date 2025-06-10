// src/routes/career.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CareerModel, ICareer } from './schemas/career'; 
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

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
		// Ruta para crear una nueva carrera
		this.app.getAppServer().post(
			`${this.route}/careers`,
			authMiddleware, // Asegúrate de que solo los usuarios autenticados (y posiblemente administradores) puedan crear carreras
			this.createCareer.bind(this)
		);

		// Ruta para obtener todas las carreras
		this.app.getAppServer().get(
			`${this.route}/careers`,
			this.listCareers.bind(this)
		);

		// Ruta para actualizar una carrera existente
		this.app.getAppServer().put(
			`${this.route}/careers/:id`,
			authMiddleware,
			this.updateCareer.bind(this)
		);

		// Ruta para eliminar una carrera
		this.app.getAppServer().delete(
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
			return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Error al crear la carrera', error });
		}
	}

	private async listCareers(req: Request, res: Response): Promise<Response> {
		try {
			const careers = await this.careerModel
			.find()
			.populate('facultyId','name')   // trae solo el nombre de facultad
			.exec();
			return res.status(StatusCodes.OK).json({ careers });
		} catch (error) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al listar las carreras', error });
		}
	}

	private async updateCareer(req: Request, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const { name, description, facultyId } = req.body;
			const updatedCareer = await this.careerModel.findByIdAndUpdate(
				id,
				{ name, description, facultyId },
				{ new: true }
			).exec();
			return res.status(StatusCodes.OK).json({ career: updatedCareer });
		} catch (error) {
			return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Error al actualizar la carrera', error });
		}
	}

	private async deleteCareer(req: Request, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			await this.careerModel.findByIdAndDelete(id).exec();
			return res.status(StatusCodes.OK).json({ message: 'Carrera eliminada correctamente' });
		} catch (error) {
			return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Error al eliminar la carrera', error });
		}
	}
}

