import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';

import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { HelpThreadModel } from './schemas/helpThread';
import { AcademicHelpModel } from './schemas/academicHelp';
import SocketController from './socket';
import { getUploadMiddleware } from '../middlware/upload';
import fs from 'fs/promises';
import { SettingsModel } from './schemas/settings';
import { analyzeImage } from '../moderation/images/nudenetService';
import { analyzeVideo } from '../moderation/videos/nudenetVideoService';
import { translateText } from '../moderation/text/translationService';
import { analyzeComment } from '../moderation/text/toxicityService';
import { NotificationModel } from './schemas/notification';
import { UserModel } from './schemas/user';
import {htmlToPlainText} from '../moderation/text/htmlToPlainText';

interface AuthRequest extends Request {
	userId?: string;
	file?: Express.Multer.File;
}

export class HelpThreadController {
	private route: string;
	private app: App;
	private socket: SocketController;
	private threadModel: ReturnType<typeof HelpThreadModel>;
	private helpModel  : ReturnType<typeof AcademicHelpModel>;
	private notificationModel: ReturnType<typeof NotificationModel>;


	constructor(app: App, route: string, socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.notificationModel = NotificationModel(this.app.getClientMongoose());

		this.socket = socketController;
		const client = this.app.getClientMongoose();
		this.threadModel = HelpThreadModel(client);
		this.helpModel   = AcademicHelpModel(client);
		this.initRoutes();
	}

	private initRoutes(): void {
		const server = this.app.getAppServer();

		server.get(
			`${this.route}/academic-help/:id/thread`,
			authMiddleware,
			this.getThread.bind(this)
		);

		server.post(
			`${this.route}/academic-help/:id/thread`,
			authMiddleware,this.getUploadMiddleware(),
			this.postMessage.bind(this)
		);

		server.put(
			`${this.route}/thread/:threadId/solve/:msgId`,
			authMiddleware,
			this.markAsSolved.bind(this)
		);

		server.put(
			`${this.route}/thread/:threadId/vote/:msgId`,
			authMiddleware,
			this.voteMessage.bind(this)
		);
		server.put(
			`${this.route}/academic-help/:helpId/thread/:msgId`,
			authMiddleware,
			this.getUploadMiddleware(),
			this.updateMessage.bind(this)
		);
		server.delete(
			`${this.route}/academic-help/:helpId/thread/:msgId`,
			authMiddleware,
			this.deleteMessage.bind(this)
		);

	}

	/** Obtener hilo completo */
	private async getThread(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const thread = await this.threadModel
			.findOne({ helpId: id })
			.populate('messages.author', 'username profilePicture')
			.exec();

			return res.status(StatusCodes.OK).json({ thread });
		} catch (e) {
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al obtener el hilo', error: e });
		}
	}
	private getUploadMiddleware() {
		const upload = getUploadMiddleware(10 * 1024 * 1024); // 10 MB
		return upload.single('file'); // el campo se llama "file" en el front
	}

private async postMessage(req: AuthRequest, res: Response): Promise<Response> {
	const deleteIfExists = async (p?: string) => {
		if (!p) return;
		try { await fs.unlink(p); } catch { /* ignore */ }
	};

	try {
		const { id } = req.params;          // helpId
		const { content, language = 'es' } = req.body as any;
		const userId = req.userId;
		const file = req.file;

		if (!userId) {
			await deleteIfExists(file?.path);
			return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
		}

		if (!content && !file) {
			return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'El contenido o el archivo son obligatorios' });
		}

		// === Settings ===
		const Settings = SettingsModel(this.app.getClientMongoose());
		const settings = await Settings.findOne().exec();

		const aiModerationEnabled =
			settings?.aiModerationEnabled ?? true;

		const textModerationEnabled =
			(settings as any)?.helpMessageTextModerationEnabled ??
			settings?.commentModerationEnabled ??
			true;

		if (file && aiModerationEnabled) {
			if (file.mimetype.startsWith('image/')) {
				const isNSFW = await analyzeImage(file.path);
				if (isNSFW) {
					await deleteIfExists(file.path);
					return res
						.status(StatusCodes.BAD_REQUEST)
						.json({ message: 'Contenido inapropiado detectado en la imagen' });
				}
			} else if (file.mimetype.startsWith('video/')) {
				const isNSFW = await analyzeVideo(file.path);
				if (isNSFW) {
					await deleteIfExists(file.path);
					return res
						.status(StatusCodes.BAD_REQUEST)
						.json({ message: 'Contenido inapropiado detectado en el video' });
				}
			}
		}

		const rawContent: string =
			typeof content === 'string' ? content : '';

		const plainForModeration = htmlToPlainText(rawContent);

		if (textModerationEnabled && plainForModeration.length > 0) {
			let contentToCheck = plainForModeration;

			if (language && language !== 'en') {
				try {
					contentToCheck = await translateText(plainForModeration, 'en');
				} catch (e) {
					console.error(
						'Error en la traducción del mensaje (help message):',
						e
					);
				}
			}

			const bad = await analyzeComment(contentToCheck);
			if (bad) {
				await deleteIfExists(file?.path);
				return res
					.status(StatusCodes.BAD_REQUEST)
					.json({ message: 'El mensaje contiene lenguaje inapropiado.' });
			}
		}

		let thread = await this.threadModel.findOne({ helpId: id });

		const message: any = {
			_id:        new Types.ObjectId(),
			author:     new Types.ObjectId(userId),
			content:    content ?? '',     
			created_at: new Date(),
			votes:      0,
		};

		if (file) {
			message.attachments = [`uploads/${file.filename}`];
		}

		if (!thread) {
			thread = new this.threadModel({
				helpId: id,
				messages: [message],
			});
		} else {
			(thread.messages as any).push(message);
		}

		await thread.save();

		try {
			const AcademicHelp = AcademicHelpModel(this.app.getClientMongoose());
			const help = await AcademicHelp.findById(id)
				.select('user topic') // <-- dueño = user
				.exec();

			if (help) {
				const helpOwnerId: string = help.user.toString(); // AJUSTA ESTE CAMPO

				if (helpOwnerId !== userId) {
					const User = UserModel(this.app.getClientMongoose());
					const replier = await User.findById(userId).select('username').exec();
					const replierName = replier?.username ?? 'Un usuario';

					const notification = new this.notificationModel({
						recipient: helpOwnerId,
						sender: new Types.ObjectId(userId),
						type: 'academic_help_reply',
						message: `${replierName} ha respondido a tu solicitud de ayuda académica`,
						data: {
							helpId: help._id,
							messageId: message._id,
						},
					});

					await notification.save();

					this.socket.emitNotification(
						helpOwnerId.toString(),
						notification
					);
				}
			}
		} catch (err) {
			console.error('Error creando notificación de respuesta de ayuda:', err);
		}

		this.socket.emitToRoom(id, 'new-help-message', message);

		return res.status(StatusCodes.CREATED).json({ message });
	} catch (e) {
		console.error('Error al publicar mensaje:', e);
		if (req.file?.path) {
			try { await fs.unlink(req.file.path); } catch { /* ignore */ }
		}
		return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al publicar mensaje', error: e });
	}
}



	private async markAsSolved(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { threadId, msgId } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
			}

			const thread = await this.threadModel.findById(threadId).exec();
			if (!thread) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Hilo no encontrado' });
			}

			if (!thread.helpId) {
				return res
				.status(StatusCodes.BAD_REQUEST)
				.json({ message: 'El hilo no está asociado a una ayuda académica' });
			}

			const help = await this.helpModel
			.findById(thread.helpId)
			.select('user status')
			.exec();

			if (!help) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Ayuda académica no encontrada' });
			}

			if (help.user.toString() !== userId) {
				return res
				.status(StatusCodes.FORBIDDEN)
				.json({ message: 'Solo el autor de la ayuda puede marcar una solución' });
			}

			const message: any = (thread.messages as any).id(msgId);
			if (!message) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Mensaje no encontrado en este hilo' });
			}

			let solved: boolean;

			if (thread.solvedMessage && thread.solvedMessage.toString() === msgId) {
				// estaba marcada esta misma → desmarcar
				thread.solvedMessage = undefined;
				solved = false;

				await this.helpModel
				.findByIdAndUpdate(
					thread.helpId,
					{ status: 'open', updated_at: new Date() },
					{ new: true }
				)
				.exec();
			} else {
				// marcar como solución
				thread.solvedMessage = message._id;
				solved = true;

				await this.helpModel
				.findByIdAndUpdate(
					thread.helpId,
					{ status: 'resolved', updated_at: new Date() },
					{ new: true }
				)
				.exec();
			}

			await thread.save();

			/* ───────── NOTIFICACIÓN: solución marcada ───────── */
			if (solved) {
				try {
					const messageAuthorId = message.author.toString();
					const helpOwnerId = help.user.toString();

					// si el autor de la respuesta es distinto al dueño de la ayuda
					if (messageAuthorId !== helpOwnerId) {
						const notification = new this.notificationModel({
							recipient: messageAuthorId,
							sender: new Types.ObjectId(helpOwnerId), // quien marcó la solución
							type: 'academic_help_solution_marked',
							message: 'Tu respuesta fue marcada como solución correcta',
							data: {
								helpId: thread.helpId,
								threadId: thread._id,
								messageId: message._id,
							},
						});

						await notification.save();

						this.socket.emitNotification(
							messageAuthorId.toString(),
							notification
						);
					}
				} catch (err) {
					console.error('Error creando notificación de solución marcada:', err);
				}
			}

			return res.status(StatusCodes.OK).json({
				message: solved ? 'Marcado como solución' : 'Solución desmarcada',
				solved,
				solvedMessage: solved ? message._id : null,
			});
		} catch (e) {
			console.error('Error al marcar solución:', e);
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al marcar solución', error: e });
		}
	}


	private async voteMessage(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { threadId, msgId } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
			}

			const thread = await this.threadModel.findById(threadId).exec();

			if (!thread) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Hilo no encontrado' });
			}

			const message: any = (thread.messages as any).id(msgId);
			if (!message) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Mensaje no encontrado' });
			}

			// (Opcional) impedir que el autor vote su propio mensaje:
			// if (message.author.toString() === userId) {
			//   return res
			//     .status(StatusCodes.BAD_REQUEST)
			//     .json({ message: 'No puedes votar tu propia respuesta' });
			// }

			// Nos aseguramos de tener array
			if (!message.votedBy) {
				message.votedBy = [];
			}

			const alreadyIndex = message.votedBy.findIndex(
				(u: any) => u.toString() === userId
			);

			let voted: boolean;

			if (alreadyIndex === -1) {
				// No había votado → agregar voto
				message.votedBy.push(new Types.ObjectId(userId));
				voted = true;
			} else {
				// Ya había votado → quitar voto
				message.votedBy.splice(alreadyIndex, 1);
				voted = false;
			}

			message.votes = message.votedBy.length;

			await thread.save();

			try {
				const messageAuthorId = message.author.toString();

				if (messageAuthorId !== userId && message.votes >= 0) {
					const Notification = this.notificationModel;

					if (message.votes === 0) {
						await Notification.deleteOne({
							recipient: messageAuthorId,
							type: 'academic_help_vote',
							'data.messageId': message._id,
						}).exec();
					} else {
						const existing = await Notification.findOne({
							recipient: messageAuthorId,
							type: 'academic_help_vote',
							'data.messageId': message._id,
						}).exec();

						const voteCount = message.votes;

						const baseText =
							voteCount === 1
								? 'Tu respuesta tiene 1 voto'
								: `Tu respuesta tiene ${voteCount} votos`;

								if (existing) {
									existing.data = {
										...(existing.data || {}),
										helpId: thread.helpId,
										threadId: thread._id,
										messageId: message._id,
										voteCount,
									};
									existing.message = baseText;
									await existing.save();

									this.socket.emitNotification(
										messageAuthorId.toString(),
										existing
									);
								} else {
									const notification = new Notification({
										recipient: messageAuthorId,
										sender: new Types.ObjectId(userId),
										type: 'academic_help_vote',
										message: baseText,
										data: {
											helpId: thread.helpId,
											threadId: thread._id,
											messageId: message._id,
											voteCount,
										},
									});

									await notification.save();
									this.socket.emitNotification(
										messageAuthorId.toString(),
										notification
									);
								}
					}
				}
			} catch (err) {
				console.error('Error creando/actualizando notificación de voto:', err);
			}

			return res.status(StatusCodes.OK).json({
				message: 'Voto actualizado',
				voted,           // true = ahora tiene voto, false = se eliminó
				votes: message.votes,
				msgId: message._id,
			});
		} catch (e) {
			console.error('Error al votar', e);
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al votar', error: e });
		}
	}


private async updateMessage(req: AuthRequest, res: Response): Promise<Response> {
	const deleteIfExists = async (p?: string) => {
		if (!p) return;
		try { await fs.unlink(p); } catch { /* ignore */ }
	};

	try {
		const { helpId, msgId } = req.params;
		const userId = req.userId;
		const { content, removeAttachment, language = 'es' } = req.body as any;
		const file = req.file;

		if (!userId) {
			await deleteIfExists(file?.path);
			return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
		}

		const thread = await this.threadModel.findOne({ helpId }).exec();
		if (!thread) {
			await deleteIfExists(file?.path);
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Hilo no encontrado' });
		}

		const message: any = (thread.messages as any).id(new Types.ObjectId(msgId));
		if (!message) {
			await deleteIfExists(file?.path);
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Mensaje no encontrado' });
		}

		if (String(message.author) !== String(userId)) {
			await deleteIfExists(file?.path);
			return res
				.status(StatusCodes.FORBIDDEN)
				.json({ message: 'No tienes permiso para editar este mensaje' });
		}

		const Settings = SettingsModel(this.app.getClientMongoose());
		const settings = await Settings.findOne().exec();

		const aiModerationEnabled =
			settings?.aiModerationEnabled ?? true;

		const textModerationEnabled =
			(settings as any)?.helpMessageTextModerationEnabled ??
			settings?.commentModerationEnabled ??
			true;

		if (file && aiModerationEnabled) {
			if (file.mimetype.startsWith('image/')) {
				const isNSFW = await analyzeImage(file.path);
				if (isNSFW) {
					await deleteIfExists(file.path);
					return res
						.status(StatusCodes.BAD_REQUEST)
						.json({ message: 'Contenido inapropiado detectado en la imagen' });
				}
			} else if (file.mimetype.startsWith('video/')) {
				const isNSFW = await analyzeVideo(file.path);
				if (isNSFW) {
					await deleteIfExists(file.path);
					return res
						.status(StatusCodes.BAD_REQUEST)
						.json({ message: 'Contenido inapropiado detectado en el video' });
				}
			}
		}

		const hasContentUpdate =
			typeof content === 'string' && content.trim().length > 0;

		if (textModerationEnabled && hasContentUpdate) {
			const rawContent: string = content;
			const plainForModeration = htmlToPlainText(rawContent);

			if (plainForModeration.length > 0) {
				let contentToCheck = plainForModeration;

				if (language && language !== 'en') {
					try {
						contentToCheck = await translateText(plainForModeration, 'en');
					} catch (e) {
						console.error(
							'Error en la traducción del mensaje (update help message):',
							e
						);
					}
				}

				const bad = await analyzeComment(contentToCheck);
				if (bad) {
					await deleteIfExists(file?.path);
					return res
						.status(StatusCodes.BAD_REQUEST)
						.json({ message: 'El mensaje contiene lenguaje inapropiado.' });
				}
			}
		}

		if (typeof content !== 'undefined') {
			message.content = content;
		}

		if (file) {
			message.attachments = [`uploads/${file.filename}`];
		} else if (removeAttachment === 'true') {
			message.attachments = [];
		}

		thread.markModified('messages');
		await thread.save();

		this.socket.emitToRoom(helpId, 'updated-help-message', {
			_id: message._id,
			helpId,
		});

		return res.status(StatusCodes.OK).json({ message: 'Mensaje actualizado' });
	} catch (e) {
		console.error('Error al actualizar mensaje:', e);
		if (req.file?.path) {
			try { await fs.unlink(req.file.path); } catch { /* ignore */ }
		}
		return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al actualizar mensaje', error: e });
	}
}



	private async deleteMessage(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { helpId, msgId } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
			}

			const thread = await this.threadModel.findOne({ helpId }).exec();
			if (!thread) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Hilo no encontrado' });
			}

			const message: any = (thread.messages as any).id(new Types.ObjectId(msgId));
			if (!message) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Mensaje no encontrado' });
			}

			if (String(message.author) !== String(userId)) {
				return res
				.status(StatusCodes.FORBIDDEN)
				.json({ message: 'No tienes permiso para eliminar este mensaje' });
			}

			message.deleteOne();        // elimina subdocumento
			thread.markModified('messages');
			await thread.save();

			this.socket.emitToRoom(helpId, 'deleted-help-message', {
				_id: msgId,
				helpId,
			});

			return res.status(StatusCodes.OK).json({ message: 'Mensaje eliminado' });
		} catch (e) {
			console.error('Error al eliminar mensaje:', e);
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al eliminar mensaje', error: e });
		}
	}

}

