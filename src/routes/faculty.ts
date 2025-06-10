import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FacultyModel } from './schemas/faculty';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

export class FacultyController {
	private route: string;
	private app: App;
	private model: ReturnType<typeof FacultyModel>;

	constructor(app: App, routePrefix: string) {
		this.route = `${routePrefix}/faculties`;
		this.app = app;
		this.model = FacultyModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {
		const srv = this.app.getAppServer();

		srv.post(this.route, authMiddleware, this.create.bind(this));
		srv.get(this.route, this.list.bind(this));
		srv.put(`${this.route}/:id`, authMiddleware, this.update.bind(this));
		srv.delete(`${this.route}/:id`, authMiddleware, this.remove.bind(this));
	}

	private async create(req: Request, res: Response) {
		try {
			const faculty = await this.model.create(req.body);
			res.status(StatusCodes.CREATED).json({ faculty });
		} catch (err) {
			res.status(StatusCodes.BAD_REQUEST).json({ message:'Error al crear', err });
		}
	}

	private async list(_req: Request, res: Response) {
		const faculties = await this.model.find().sort({ name:1 }).exec();
		res.status(StatusCodes.OK).json({ faculties });
	}

	private async update(req: Request, res: Response) {
		const { id } = req.params;
		const faculty = await this.model.findByIdAndUpdate(id, req.body, { new:true });
		res.status(StatusCodes.OK).json({ faculty });
	}

	private async remove(req: Request, res: Response) {
		await this.model.findByIdAndDelete(req.params.id);
		res.status(StatusCodes.OK).json({ message:'Eliminado' });
	}
}

