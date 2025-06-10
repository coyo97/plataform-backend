import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AcademicHelpModel } from './schemas/academicHelp';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { getUploadMiddleware } from '../middlware/upload';

interface AuthRequest extends Request {
	userId?: string;
	file?: Express.Multer.File;
}

export class AcademicHelpController {
	private route: string;
	private app: App;
	private helpModel: ReturnType<typeof AcademicHelpModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.helpModel = AcademicHelpModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {
		const server = this.app.getAppServer();

		server.post(
			`${this.route}/academic-help`,
			authMiddleware,
			this.getUploadMiddleware(), // para archivos
			this.createHelp.bind(this)
		);

		server.get(
			`${this.route}/academic-help`,
			authMiddleware,
			this.getHelpList.bind(this)
		);
		this.app.getAppServer().get(
			`${this.route}/academic-help/:id`,
			authMiddleware,
			this.getHelpById.bind(this)
		);

		this.app.getAppServer().put(
			`${this.route}/academic-help/:id/resolve`,
			authMiddleware,
			this.resolveHelp.bind(this)
		);


	}

	private getUploadMiddleware() {
		const upload = getUploadMiddleware(10 * 1024 * 1024); // 10 MB
		return upload.single('file');
	}

	private async createHelp(req: AuthRequest, res: Response): Promise<void> {
		try {
			const userId = req.userId;
			const {
				facultyId, careerId, cycleId,
				subjectId, unitId,
				topic, description, requestType
			} = req.body;                      // <<== nuevos campos

			/* Compatibilidad: si front viejo envía 'faculty' etc.
			   los copiamos a *_id cuando sea posible */
			const helpDoc = {
				user: userId,
				facultyId, careerId, cycleId, subjectId, unitId,
				topic, description,
				requestType,
				/* legacy (por si llegan) */
				faculty : req.body.faculty,
				semester: req.body.semester,
				subject : req.body.subject,
				fileUrl : req.file ? `uploads/${req.file.filename}` : undefined,
				status  : 'open',
				created_at: new Date(),
				updated_at: new Date()
			};

			const help = await this.helpModel.create(helpDoc);
			res.status(StatusCodes.CREATED).json({ help });
		} catch (error) {
			console.error('Error al crear ayuda académica:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message:'Error al crear ayuda', error });
		}
	}

	private async getHelpList(req: AuthRequest, res: Response): Promise<void> {
		try {
			const {
				careerId, subjectId, cycleId,
				requestType, status
			} = req.query;

			const q: any = {};
			if (careerId   ) q.careerId    = careerId;
			if (subjectId  ) q.subjectId   = subjectId;
			if (cycleId    ) q.cycleId     = cycleId;
			if (requestType) q.requestType = requestType;
			if (status     ) q.status      = status;

			/* fallback filtros legacy */
			if (req.query.subject) q.subject = req.query.subject;

			const helpList = await this.helpModel
			.find(q)
			.sort({ created_at:-1 })
			.populate('user', 'username profilePicture')
			.populate('subjectId', 'name code')
			.populate('cycleId')             // si quieres ver datos del ciclo
			.exec();

			res.status(StatusCodes.OK).json({ helps: helpList });
		} catch (err) {
			console.error('Error listando ayudas:', err);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message:'Error al listar ayudas', err });
		}
	}

	private async getHelpById(req: AuthRequest, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const help = await this.helpModel
			.findById(id)
			.populate('user', 'username profilePicture')
			.exec();

			if (!help) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Ayuda no encontrada' });
				return;
			}

			res.status(StatusCodes.OK).json({ help });
		} catch (error) {
			console.error('Error al obtener la ayuda:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener la ayuda', error });
		}
	}

	private async resolveHelp(req: AuthRequest, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const userId = req.userId;

			const help = await this.helpModel.findById(id).exec();

			if (!help) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Ayuda no encontrada' });
				return;
			}

			// Solo el autor puede marcarla como resuelta
			if (help.user.toString() !== userId) {
				res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para modificar esta ayuda' });
				return;
			}

			help.status = 'resolved';
			help.updated_at = new Date();

			await help.save();

			res.status(StatusCodes.OK).json({ message: 'Ayuda marcada como resuelta', help });
		} catch (error) {
			console.error('Error al resolver ayuda:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al resolver ayuda', error });
		}
	}

}

