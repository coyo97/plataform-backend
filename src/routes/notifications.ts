// src/routes/notifications.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { NotificationModel } from './schemas/notification';
import App from '../app';
import { authMiddleware, } from '../middlware/authMiddlewares';
import SocketController from './socket';

interface AuthRequest extends Request {
	userId?: string;
}

export class NotificationController {
	private route: string;
	private app: App;
	private notificationModel: ReturnType<typeof NotificationModel>;
	private socketController: SocketController;

	constructor(app: App, route: string, socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.notificationModel = NotificationModel(this.app.getClientMongoose());
		this.socketController = socketController;
		this.initRoutes();
	}

	private initRoutes(): void {
		// Ruta para que los usuarios obtengan sus notificaciones
		this.app.getAppServer().get( `${this.route}/notifications`, authMiddleware, this.getUserNotifications.bind(this));

		// Ruta para que los administradores envíen notificaciones
		this.app.getAppServer().post(
			`${this.route}/notifications`,
			authMiddleware,
			//adminMiddleware,
			this.createNotification.bind(this)
		);

		// Ruta para marcar una notificación como leída
		this.app.getAppServer().put( `${this.route}/notifications/:notificationId/read`, authMiddleware, this.markAsRead.bind(this));
		// Ruta para eliminar una notificación
		this.app.getAppServer().delete( `${this.route}/notifications/:notificationId`, authMiddleware, this.deleteNotification.bind(this));
	}

	private async getUserNotifications(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'User not authenticated' });
			}

			const notifications = await this.notificationModel
			.find({ recipient: userId })
			.sort({ createdAt: -1 })
			.exec();

			return res.status(StatusCodes.OK).json({ notifications });
		} catch (error) {
			console.error('Error fetching notifications:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error fetching notifications', error });
		}
	}

	private async createNotification(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { recipients, message, type } = req.body;
			// recipients puede ser un array de IDs de usuarios o 'all' para todos los usuarios
			if (!message || !type) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Message and type are required' });
			}

			let usersToNotify = [];

			if (recipients === 'all') {
				// Obtener todos los usuarios
				const UserModel = require('./schemas/user').UserModel(this.app.getClientMongoose());
				const users = await UserModel.find().select('_id').exec();
				usersToNotify = users.map((user: any) => user._id.toString());
			} else if (Array.isArray(recipients)) {
				usersToNotify = recipients;
			}
			else if (typeof recipients === 'string') {
				usersToNotify = [recipients];

			} else {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Invalid recipients format' });
			}

			// Crear notificaciones en la base de datos
			const notificationsData = usersToNotify.map((userId: string) => ({
				recipient: userId,
				sender: req.userId, // El administrador que envía la notificación
				type,
				message,
			}));

			const notifications = await this.notificationModel.insertMany(notificationsData);

			// Enviar notificaciones en tiempo real a los usuarios conectados
			notifications.forEach((notification) => {
				const userId = notification.recipient.toString(); // Asegúrate de convertir a string si es necesario
				this.socketController.emitNotification(userId, notification);
			});


			return res.status(StatusCodes.CREATED).json({ message: 'Notifications sent', notifications });
		} catch (error) {
			console.error('Error creating notification:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error creating notification', error });
		}
	}

	private async markAsRead(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { notificationId } = req.params;
			const userId = req.userId;

			const notification = await this.notificationModel.findOneAndUpdate(
				{ _id: notificationId, recipient: userId },
				{ isRead: true },
				{ new: true }
			);

			if (!notification) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Notification not found' });
			}

			return res.status(StatusCodes.OK).json({ notification });
		} catch (error) {
			console.error('Error marking notification as read:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error marking notification as read', error });
		}
	}
	private async deleteNotification(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { notificationId } = req.params;
			const userId = req.userId;

			// Verificar que la notificación existe y pertenece al usuario
			const notification = await this.notificationModel.findOneAndDelete({
				_id: notificationId,
				recipient: userId,
			});

			if (!notification) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Notificación no encontrada' });
			}

			return res.status(StatusCodes.OK).json({ message: 'Notificación eliminada' });
		} catch (error) {
			console.error('Error al eliminar la notificación:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar la notificación', error });
		}
	}
}

