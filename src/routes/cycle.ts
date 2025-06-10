import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CycleModel } from './schemas/cycle';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

export class CycleController {
	private route: string;
	private app: App;
	private model: ReturnType<typeof CycleModel>;

	constructor(app: App, prefix: string) {
		this.route = `${prefix}/cycles`;
		this.app = app;
		this.model = CycleModel(this.app.getClientMongoose());
		this.init();
	}

	private init() {
		const s = this.app.getAppServer();
		s.post(this.route,  authMiddleware, this.create.bind(this));
		s.get (this.route,  this.list.bind(this));
		s.put (`${this.route}/:id`, authMiddleware, this.update.bind(this));
		s.delete(`${this.route}/:id`, authMiddleware, this.remove.bind(this));
	}

	private async create(req: Request, res: Response) {
		try {
			const cycle = await this.model.create(req.body);
			res.status(StatusCodes.CREATED).json({ cycle });
		} catch (e) {
			res.status(StatusCodes.BAD_REQUEST).json({ message:'Error', e });
		}
	}
	private async list(_req: Request, res: Response) {
		const cycles = await this.model.find().sort({ year:-1, number:1 }).exec();
		res.status(StatusCodes.OK).json({ cycles });
	}
	private async update(req: Request, res: Response) {
		const cycle = await this.model.findByIdAndUpdate(req.params.id, req.body, { new:true });
		res.status(StatusCodes.OK).json({ cycle });
	}
	private async remove(req: Request, res: Response) {
		await this.model.findByIdAndDelete(req.params.id);
		res.status(StatusCodes.OK).json({ message:'Eliminado' });
	}
}

