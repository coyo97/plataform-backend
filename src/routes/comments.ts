// src/routes/comments.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CommentModel } from './schemas/comment';
import App from '../app';
import { authMiddleware, adminMiddleware } from '../middlware/authMiddlewares';
import { dynamicPermissionMiddleware } from '../middlware/permissionMiddleware';

import { analyzeComment } from '../moderation/text/toxicityService';
import { translateText } from '../moderation/text/translationService';

import { NotificationModel } from './schemas/notification';
import { PublicationModel } from './schemas/publication';

import { SettingsModel } from './schemas/settings';
import SocketController from './socket'; // Importamos SocketController

interface AuthRequest extends Request {
	userId?: string;
}

export class CommentController {
	private route: string;
	private app: App;
	private commentModel: ReturnType<typeof CommentModel>;
	private socketController: SocketController; // Añadimos SocketController

	constructor(app: App, route: string, socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.commentModel = CommentModel(this.app.getClientMongoose());
		this.socketController = socketController; // Inicializamos SocketController
		this.initRoutes();
	}

	private initRoutes(): void {
		// Ruta para obtener comentarios de una publicación específica
		this.app.getAppServer().get(
			`${this.route}/publications/:publicationId/comments`,
			authMiddleware,
			dynamicPermissionMiddleware, 
			this.getComments.bind(this)
		);

		// Ruta para crear un comentario en una publicación específica
		this.app.getAppServer().post(
			`${this.route}/publications/:publicationId/comments`,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.createComment.bind(this)
		);

		// Ruta para editar un comentario
		this.app.getAppServer().put(
			`${this.route}/comments/:commentId`,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.editComment.bind(this)
		);

		// Ruta para eliminar un comentario
		this.app.getAppServer().delete(
			`${this.route}/comments/:commentId`,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.deleteComment.bind(this)
		);

		// Rutas para el estado del moderador de comentarios
		this.app.getAppServer().get(
			`${this.route}/comment-moderation-status`,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.getCommentModerationStatus.bind(this)
		);

		this.app.getAppServer().put(
			`${this.route}/comment-moderation-status`,
			authMiddleware,
			dynamicPermissionMiddleware,
			this.updateCommentModerationStatus.bind(this)
		);

	}

	private async getComments(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { publicationId } = req.params;
			const comments = await this.commentModel.find({ publication: publicationId }).populate('author').exec();
			return res.status(StatusCodes.OK).json({ comments });
		} catch (error) {
			console.error('Error fetching comments:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error fetching comments', error });
		}
	}


	private async createComment(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { publicationId } = req.params;
			const { content, language = 'es' } = req.body;

			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'User not authenticated' });
			}

			// Verificar el estado del moderador de comentarios
			const Settings = SettingsModel(this.app.getClientMongoose());
			const settings = await Settings.findOne().exec();
			const commentModerationEnabled = settings?.commentModerationEnabled ?? true;

			let translatedContent = content;

			if (commentModerationEnabled) {
				if (language && language !== 'en') {
					try {
						translatedContent = await translateText(content, 'en');
					} catch (error) {
						console.error('Error en la traducción:', error);
					}
				}
			}

			// Analizar si el comentario es inapropiado
			const isInappropriate = await analyzeComment(translatedContent);

			if (isInappropriate) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Comentario inapropiado. Por favor, evita lenguaje ofensivo.' });
			}

			// Guardar el comentario si es apropiado
			const newComment = new this.commentModel({
				content,
				author: userId,
				publication: publicationId,
			});

			const savedComment = await newComment.save();
			await PublicationModel(this.app.getClientMongoose()).findByIdAndUpdate(
				publicationId,
				{ $inc: { commentsCount: 1 } }
			);

			// Popula el comentario para obtener detalles del autor
			const populatedComment = await savedComment.populate('author', 'username');

			// Obtener la publicación para obtener el autor
			const publication = await PublicationModel(this.app.getClientMongoose())
			.findById(publicationId)
			.populate('author') // Popula el autor para obtener su información
			.exec();

			if (publication) {
				// Crear una nueva notificación
				const notification = new (NotificationModel(this.app.getClientMongoose()))({
					recipient: publication.author._id,
					sender: userId,
					type: 'comment',
					message: 'Ha comentado tu publicación',
					data: {
						publicationId: publicationId,
						commentId: populatedComment._id,
					},
				});
				await notification.save();

				// **Emitir notificación en tiempo real utilizando SocketController**
				const notificationData = {
					_id: notification._id,
					recipient: notification.recipient,
					sender: notification.sender,
					type: notification.type,
					message: notification.message,
					isRead: notification.isRead,
					createdAt: notification.createdAt,
					data: notification.data, // Include the data field	
				};
				this.socketController.emitNotification(publication.author._id.toString(), notificationData);
			}

			// **Emitir el evento de nuevo comentario a la sala de la publicación**
			this.socketController.emitToRoom(publicationId, 'comment:new', populatedComment);

			return res.status(StatusCodes.CREATED).json({ comment: savedComment });
		} catch (error) {
			console.error('Error creating comment:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error creating comment', error });
		}
	}	

	// Método para editar un comentario
	private async editComment(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { commentId } = req.params;
			const { content } = req.body;
			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'User not authenticated' });
			}

			// Verifica si el comentario pertenece al usuario autenticado
			const comment = await this.commentModel.findOne({ _id: commentId, author: userId }).exec();

			if (!comment) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Comment not found or you are not the author' });
			}

			comment.content = content;
			const updatedComment = await comment.save();
			await updatedComment.populate('author', 'username');
			this.socketController.emitToRoom(
				(updatedComment.publication as any).toString(), 
				'comment:update',
				updatedComment
			);

			return res.status(StatusCodes.OK).json({ comment: updatedComment });
		} catch (error) {
			console.error('Error editing comment:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error editing comment', error });
		}
	}

	// Método para eliminar un comentario
	private async deleteComment(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { commentId } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'User not authenticated' });
			}

			// Verifica si el comentario pertenece al usuario autenticado
			const comment = await this.commentModel.findOneAndDelete({ _id: commentId, author: userId }).exec();

			if (!comment) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Comment not found or you are not the author' });
			}
			if (comment) {
				await PublicationModel(this.app.getClientMongoose()).findByIdAndUpdate(
					comment.publication,
					{ $inc: { commentsCount: -1 } }
				);
				this.socketController.emitToRoom(
					(comment.publication as any).toString(),  
					'comment:delete',
					(comment._id as any).toString()          
				);

			}
			return res.status(StatusCodes.OK).json({ message: 'Comment deleted successfully' });
		} catch (error) {
			console.error('Error deleting comment:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error deleting comment', error });
		}
	}

	// Método para obtener el estado actual del moderador de comentarios
	private async getCommentModerationStatus(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const Settings = SettingsModel(this.app.getClientMongoose());
			const settings = await Settings.findOne().exec();
			const commentModerationEnabled = settings?.commentModerationEnabled ?? true;
			return res.status(StatusCodes.OK).json({ commentModerationEnabled });
		} catch (error) {
			console.error('Error al obtener el estado del moderador de comentarios:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener el estado del moderador de comentarios', error });
		}
	}

	// Método para actualizar el estado del moderador de comentarios
	private async updateCommentModerationStatus(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { commentModerationEnabled } = req.body;

			if (typeof commentModerationEnabled !== 'boolean') {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El valor de commentModerationEnabled debe ser booleano' });
			}

			const Settings = SettingsModel(this.app.getClientMongoose());
			let settings = await Settings.findOne().exec();

			if (!settings) {
				settings = new Settings({ commentModerationEnabled });
			} else {
				settings.commentModerationEnabled = commentModerationEnabled;
			}

			await settings.save();

			return res.status(StatusCodes.OK).json({ message: 'Estado del moderador de comentarios actualizado', commentModerationEnabled });
		} catch (error) {
			console.error('Error al actualizar el estado del moderador de comentarios:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar el estado del moderador de comentarios', error });
		}
	}

}

