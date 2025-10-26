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

 // Crear
    server.post( `${this.route}/academic-help`, authMiddleware, this.getUploadMiddleware(), this.createHelp.bind(this),);

    // Listado general (con filtros)
    server.get( `${this.route}/academic-help`, authMiddleware, this.getHelpList.bind(this),);

    // Listado SOLO del usuario autenticado
    server.get( `${this.route}/my-academic-help`, authMiddleware, this.getMyHelpList.bind(this),);

    // Es importante declarar primero rutas específicas para no colisionar con :id
    server.put( `${this.route}/academic-help/:id/resolve`, authMiddleware, this.resolveHelp.bind(this),);

    // Obtener por id (lectura pública autenticada)
    server.get( `${this.route}/academic-help/:id`, authMiddleware, this.getHelpById.bind(this),);

    // Actualizar SOLO si es autor (archivo opcional)
    server.put( `${this.route}/academic-help/:id`, authMiddleware, this.getUploadMiddleware(), this.updateMyHelp.bind(this),);

    // Eliminar SOLO si es autor
    server.delete( `${this.route}/academic-help/:id`, authMiddleware, this.deleteMyHelp.bind(this),);	
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
			const { careerId, subjectId, cycleId, requestType, status, facultyId, unitId } = req.query as any;

			const q: any = {};
			if (careerId)    q.careerId    = careerId;
			if (subjectId)   q.subjectId   = subjectId;
			if (cycleId)     q.cycleId     = cycleId;
			if (facultyId)   q.facultyId   = facultyId;
			if (unitId)      q.unitId      = unitId;  
			if (requestType) q.requestType = requestType;
			if (status)      q.status      = status;
			/* fallback filtros legacy */
			if (req.query.subject) q.subject = req.query.subject;

			const helpList = await this.helpModel
			.find(q)
			.sort({ created_at: -1 })
			.populate('user', 'username profilePicture')
			.populate('subjectId', 'name code')
			.populate('careerId', 'name')   
			.populate('facultyId', 'name') 
			.populate('unitId', 'name')  
			.populate('cycleId', 'name')  
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
	// Nuevo: lista SOLO las ayudas del usuario autenticado
	private async getMyHelpList(req: AuthRequest, res: Response): Promise<void> {
		try {
			const userId = req.userId;
			if (!userId) {
				res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
				return;
			}

			const helps = await this.helpModel
			.find({ user: userId })
			.sort({ created_at: -1 })
			.populate('subjectId', 'name code')
			.populate('careerId', 'name')
			.populate('facultyId', 'name')
			.populate('unitId', 'name')
			.populate('cycleId', 'name')
			.exec();

			res.status(StatusCodes.OK).json({ helps });
		} catch (error) {
			console.error('Error al listar mis ayudas:', error);
			res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al listar mis ayudas', error });
		}
	}
	// Nuevo: actualizar SOLO si es autor (acepta archivo opcional)
	private async updateMyHelp(req: AuthRequest, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const userId = req.userId;

			const help = await this.helpModel.findById(id).exec();
			if (!help) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Ayuda no encontrada' });
				return;
			}
			if (help.user.toString() !== userId) {
				res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para editar esta ayuda' });
				return;
			}

			// Campos permitidos a actualizar
			const {
				facultyId, careerId, cycleId,
				subjectId, unitId,
				topic, description, requestType, status,
			} = req.body as any;

			const updateData: any = {
				updated_at: new Date(),
			};

			if (typeof facultyId   !== 'undefined') updateData.facultyId   = facultyId;
			if (typeof careerId    !== 'undefined') updateData.careerId    = careerId;
			if (typeof cycleId     !== 'undefined') updateData.cycleId     = cycleId;
			if (typeof subjectId   !== 'undefined') updateData.subjectId   = subjectId;
			if (typeof unitId      !== 'undefined') updateData.unitId      = unitId;
			if (typeof topic       !== 'undefined') updateData.topic       = topic;
			if (typeof description !== 'undefined') updateData.description = description;
			if (typeof requestType !== 'undefined') updateData.requestType = requestType;

			// Permitir que el autor cambie el status solo entre 'open' y 'resolved' si deseas (opcional)
			if (typeof status !== 'undefined') {
				if (['open', 'resolved'].includes(status)) {
					updateData.status = status;
				}
			}

			// Archivo opcional
			if (req.file) {
				updateData.fileUrl = `uploads/${req.file.filename}`;
			}

			const updated = await this.helpModel
			.findByIdAndUpdate(id, updateData, { new: true })
			.exec();

			res.status(StatusCodes.OK).json({ help: updated });
		} catch (error) {
			console.error('Error al actualizar ayuda:', error);
			res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al actualizar ayuda', error });
		}
	}

	// Nuevo: eliminar SOLO si es autor
	private async deleteMyHelp(req: AuthRequest, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const userId = req.userId;

			const help = await this.helpModel.findById(id).exec();
			if (!help) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Ayuda no encontrada' });
				return;
			}
			if (help.user.toString() !== userId) {
				res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para eliminar esta ayuda' });
				return;
			}

			await this.helpModel.findByIdAndDelete(id).exec();

			res.status(StatusCodes.OK).json({ message: 'Ayuda eliminada correctamente' });
		} catch (error) {
			console.error('Error al eliminar ayuda:', error);
			res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al eliminar ayuda', error });
		}
	}
}

