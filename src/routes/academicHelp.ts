import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AcademicHelpModel } from './schemas/academicHelp';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { getUploadMiddleware } from '../middlware/upload';
import {dynamicPermissionMiddleware} from '../middlware/permissionMiddleware';
import fs from 'fs/promises';
import { SettingsModel } from './schemas/settings';
import { analyzeComment } from '../moderation/text/toxicityService';
import { translateText } from '../moderation/text/translationService';
import { analyzeImage } from '../moderation/images/nudenetService';
import { analyzeVideo } from "../moderation/videos/nudenetVideoService";
import { SubjectModel, ISubject } from './schemas/subject';

import { UserModel } from './schemas/user';
import { CareerModel, ICareer } from './schemas/career';

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
		server.post( `${this.route}/academic-help`, authMiddleware,dynamicPermissionMiddleware, this.getUploadMiddleware(), this.createHelp.bind(this),);

		// Listado general (con filtros)
		server.get( `${this.route}/academic-help`, authMiddleware, dynamicPermissionMiddleware, this.getHelpList.bind(this),);

		// Listado SOLO del usuario autenticado
		server.get( `${this.route}/my-academic-help`, authMiddleware, this.getMyHelpList.bind(this),);

		// Es importante declarar primero rutas específicas para no colisionar con :id
		server.put( `${this.route}/academic-help/:id/resolve`, authMiddleware, this.resolveHelp.bind(this),);

		// Obtener por id (lectura pública autenticada)
		server.get( `${this.route}/academic-help/:id`, authMiddleware, this.getHelpById.bind(this),);

		// Actualizar SOLO si es autor (archivo opcional)
		server.put( `${this.route}/academic-help/:id`, authMiddleware,dynamicPermissionMiddleware, this.getUploadMiddleware(), this.updateMyHelp.bind(this),);

		// Eliminar SOLO si es autor
		server.delete( `${this.route}/academic-help/:id`, authMiddleware, dynamicPermissionMiddleware, this.deleteMyHelp.bind(this),);	
	}

	private getUploadMiddleware() {
		const upload = getUploadMiddleware(10 * 1024 * 1024); // 10 MB
		return upload.single('file');
	}


private async createHelp(req: AuthRequest, res: Response): Promise<void> {
	const deleteIfExists = async (p?: string) => {
		if (!p) return;
		try { await fs.unlink(p); } catch { /* ignore */ }
	};

	try {
		const userId = req.userId;
		const {
			facultyId,
			careerId,
			cycleId,
			subjectId,
			unitId,
			topic,
			description,
			requestType,
			language = 'es',
			scope: rawScope, 
		} = req.body;

		const file = req.file;

		if (!userId) {
			await deleteIfExists(file?.path);
			res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			return;
		}

		const User   = UserModel(this.app.getClientMongoose());
		const Career = CareerModel(this.app.getClientMongoose());
		const Subject = SubjectModel(this.app.getClientMongoose());

		const user = await User
			.findById(userId)
			.select('accountType careers')
			.populate<{ careers: ICareer[] }>('careers', 'facultyId')
			.exec();

		let scope: 'career' | 'general' =
			rawScope === 'general' ? 'general' : 'career';

		if (!user) {
			scope = 'general';
		} else if (user.accountType === 'guest') {
			scope = 'general';
		} else if (user.accountType === 'university') {
			if (rawScope !== 'general') {
				scope = 'career';
			}
		}

		let finalCareerId  = careerId as string | undefined;
		let finalFacultyId = facultyId as string | undefined;

		if (scope === 'career') {
			if ((!finalCareerId || !finalFacultyId) && user && Array.isArray(user.careers) && user.careers.length > 0) {
				const primaryCareer = user.careers[0] as unknown as ICareer;

				if (!finalCareerId && (primaryCareer as any)._id) {
					finalCareerId = (primaryCareer as any)._id.toString();
				}
				if (!finalFacultyId && (primaryCareer as any).facultyId) {
					finalFacultyId = (primaryCareer as any).facultyId.toString();
				}
			}

			if (!finalFacultyId && finalCareerId) {
				const careerDoc = await Career.findById(finalCareerId).select('facultyId').exec();
				if (careerDoc && (careerDoc as any).facultyId) {
					finalFacultyId = (careerDoc as any).facultyId.toString();
				}
			}

			if (!finalCareerId && subjectId) {
				const subjectDoc = await Subject
					.findById(subjectId)
					.select('careerId facultyId careers')
					.exec();

				if (subjectDoc) {
					// Si tu Subject tiene un solo careerId:
					if ((subjectDoc as any).careerId) {
						finalCareerId = (subjectDoc as any).careerId.toString();
					}
					// Si tu Subject tiene un array careers[]:
					if (!finalCareerId && (subjectDoc as any).careers && (subjectDoc as any).careers.length > 0) {
						finalCareerId = (subjectDoc as any).careers[0].toString();
					}
					if (!finalFacultyId && (subjectDoc as any).facultyId) {
						finalFacultyId = (subjectDoc as any).facultyId.toString();
					}
				}
			}

			if (!finalCareerId) {
				await deleteIfExists(file?.path);
				res.status(StatusCodes.BAD_REQUEST).json({
					message:
						'No se pudo determinar la carrera para esta ayuda. Selecciona al menos una materia o carrera en las opciones avanzadas, o publica en modo general.',
				});
				return;
			}
		} else {
			// scope === 'general' => publicación sin carrera/facultad
			finalCareerId  = undefined;
			finalFacultyId = undefined;
		}

		const Settings = SettingsModel(this.app.getClientMongoose());
		const settings = await Settings.findOne().exec();

		const aiModerationEnabled = settings?.aiModerationEnabled ?? true;
		const textModerationEnabled =
			(settings as any)?.helpTextModerationEnabled ??
			settings?.commentModerationEnabled ??
			true;

		if (file && aiModerationEnabled) {
			if (file.mimetype.startsWith('image/')) {
				const isNSFW = await analyzeImage(file.path);
				if (isNSFW) {
					await deleteIfExists(file.path);
					res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en la imagen' });
					return;
				}
			} else if (file.mimetype.startsWith('video/')) {
				const isNSFW = await analyzeVideo(file.path);
				if (isNSFW) {
					await deleteIfExists(file.path);
					res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en el video' });
					return;
				}
			}
		}

		if (textModerationEnabled) {
			// topic
			if (typeof topic === 'string' && topic.trim().length > 0) {
				let topicToCheck = topic;
				if (language && language !== 'en') {
					try {
						topicToCheck = await translateText(topic, 'en');
					} catch (e) {
						console.error('Error en la traducción de topic (help):', e);
					}
				}
				const badTopic = await analyzeComment(topicToCheck);
				if (badTopic) {
					await deleteIfExists(file?.path);
					res.status(StatusCodes.BAD_REQUEST).json({ message: 'El tema contiene lenguaje inapropiado.' });
					return;
				}
			}

			if (typeof description === 'string' && description.trim().length > 0) {
				let descriptionToCheck = description;
				if (language && language !== 'en') {
					try {
						descriptionToCheck = await translateText(description, 'en');
					} catch (e) {
						console.error('Error en la traducción de description (help):', e);
					}
				}
				const badDescription = await analyzeComment(descriptionToCheck);
				if (badDescription) {
					await deleteIfExists(file?.path);
					res.status(StatusCodes.BAD_REQUEST).json({ message: 'La descripción contiene lenguaje inapropiado.' });
					return;
				}
			}
		}

const helpDoc = {
	user: userId,
	facultyId: finalFacultyId,
	careerId : finalCareerId,
	cycleId,
	subjectId,
	unitId,
	topic,
	description,
	requestType,
	/* legacy (por si llegan) */
	faculty : req.body.faculty,
	semester: req.body.semester,
	subject : req.body.subject,
	fileUrl : file ? `uploads/${file.filename}` : undefined,
	status  : 'open',
	created_at: new Date(),
	updated_at: new Date()
};

const created = await this.helpModel.create(helpDoc);

const help = await this.helpModel.findById(created._id)
	.populate('user', 'username email accountType') 
	.populate({
		path: 'careerId',
		select: 'name facultyId',
		populate: { path: 'facultyId', select: 'name' }
	})
	.populate('facultyId', 'name') 
	.exec();

res.status(StatusCodes.CREATED).json({ help });

	} catch (error) {
	console.error('Error al crear ayuda académica:', error);
		if (req.file?.path) {
			try { await fs.unlink(req.file.path); } catch { /* ignore */ }
		}
		res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al crear ayuda', error });
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

					if (status === 'open' || status === 'resolved') {
			q.status = status;
		}

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
	// Nuevo: actualizar SOLO si es autor (acepta archivo opcional)}

	private async updateMyHelp(req: AuthRequest, res: Response): Promise<void> {
		const deleteIfExists = async (p?: string) => {
			if (!p) return;
			try { await fs.unlink(p); } catch { /* ignore */ }
		};

		try {
			const { id } = req.params;
			const userId = req.userId;
			const file = req.file;

			// Campos permitidos a actualizar
			const {
				facultyId, careerId, cycleId,
				subjectId, unitId,
				topic, description, requestType, status,
				language = 'es',
			} = req.body as any;

			const help = await this.helpModel.findById(id).exec();
			if (!help) {
				await deleteIfExists(file?.path);
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Ayuda no encontrada' });
				return;
			}
			if (help.user.toString() !== userId) {
				await deleteIfExists(file?.path);
				res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para editar esta ayuda' });
				return;
			}

			// === Settings ===
			const Settings = SettingsModel(this.app.getClientMongoose());
			const settings = await Settings.findOne().exec();

			const aiModerationEnabled = settings?.aiModerationEnabled ?? true;
			const textModerationEnabled =
				(settings as any)?.helpTextModerationEnabled ??
				settings?.commentModerationEnabled ??
				true;

			// === Moderación de ARCHIVO (si sube uno nuevo) ===
			if (file && aiModerationEnabled) {
				if (file.mimetype.startsWith('image/')) {
					const isNSFW = await analyzeImage(file.path);
					if (isNSFW) {
						await deleteIfExists(file.path);
						res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en la imagen' });
						return;
					}
				} else if (file.mimetype.startsWith('video/')) {
					const isNSFW = await analyzeVideo(file.path);
					if (isNSFW) {
						await deleteIfExists(file.path);
						res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en el video' });
						return;
					}
				}
			}

			// === Moderación de TEXTO (topic y description si vienen) ===
			if (textModerationEnabled) {
				// topic
				if (typeof topic === 'string' && topic.trim().length > 0) {
					let topicToCheck = topic;
					if (language && language !== 'en') {
						try {
							topicToCheck = await translateText(topic, 'en');
						} catch (e) {
							console.error('Error en la traducción de topic (update help):', e);
						}
					}
					const badTopic = await analyzeComment(topicToCheck);
					if (badTopic) {
						await deleteIfExists(file?.path);
						res.status(StatusCodes.BAD_REQUEST).json({ message: 'El tema contiene lenguaje inapropiado.' });
						return;
					}
				}

				// description
				if (typeof description === 'string' && description.trim().length > 0) {
					let descriptionToCheck = description;
					if (language && language !== 'en') {
						try {
							descriptionToCheck = await translateText(description, 'en');
						} catch (e) {
							console.error('Error en la traducción de description (update help):', e);
						}
					}
					const badDescription = await analyzeComment(descriptionToCheck);
					if (badDescription) {
						await deleteIfExists(file?.path);
						res.status(StatusCodes.BAD_REQUEST).json({ message: 'La descripción contiene lenguaje inapropiado.' });
						return;
					}
				}
			}

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
			if (file) {
				updateData.fileUrl = `uploads/${file.filename}`;
			}

			const updated = await this.helpModel
			.findByIdAndUpdate(id, updateData, { new: true })
			.exec();

			res.status(StatusCodes.OK).json({ help: updated });
		} catch (error) {
			console.error('Error al actualizar ayuda:', error);
			if (req.file?.path) {
				try { await fs.unlink(req.file.path); } catch { /* ignore */ }
			}
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

