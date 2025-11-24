// src/routes/messageController.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MessageModel, IMessage } from './schemas/message';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { GroupModel } from './schemas/group';
import { getUploadMiddleware } from '../middlware/upload';
import { SettingsModel } from './schemas/settings';
import SocketController from './socket';
import { Types, PipelineStage } from 'mongoose';
import { UserModel } from './schemas/user';
import {dynamicPermissionMiddleware} from '../middlware/permissionMiddleware';


interface AuthRequest extends Request {
	userId?: string;
}
export class MessageController {
	private route: string;
	private app: App;
	private messageModel: ReturnType<typeof MessageModel>;
	private groupModel: ReturnType<typeof GroupModel>;
	private socketController: SocketController;

	constructor(app: App, route: string, socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.messageModel = MessageModel(this.app.getClientMongoose());
		this.groupModel = GroupModel(this.app.getClientMongoose());
		this.socketController = socketController; // Inicializar SocketController
		this.initRoutes();
	}
	// Inicializa las rutas HTTP
	private initRoutes(): void {
		this.app.getAppServer().post( `${this.route}/messages/send`, authMiddleware, this.sendMessage.bind(this));

		this.app.getAppServer().get( `${this.route}/messages/conversations`, authMiddleware, dynamicPermissionMiddleware, this.getConversations.bind(this));

		this.app.getAppServer().get( `${this.route}/messages/user/:userId`, authMiddleware, dynamicPermissionMiddleware, this.getMessages.bind(this));

		this.app.getAppServer().get( `${this.route}/messages/group/:groupId`, authMiddleware,  this.getGroupMessages.bind(this));

		this.app.getAppServer().post( `${this.route}/messages/mark-as-read`, authMiddleware, this.markAsRead.bind(this));

		this.app.getAppServer().post(
			`${this.route}/messages/send-with-file`,
			authMiddleware,
			async (req, res, next) => {
				// Obtén el maxUploadSize desde la base de datos
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 50 * 1024 * 1024;

				// Obtén el middleware de subida con el tamaño actualizado
				const upload = getUploadMiddleware(maxUploadSize);

				// Llama al middleware de multer
				upload.single('file')(req, res, (err) => {
					if (err) {
						return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					}
					next();
				});
			}, // Utiliza el middleware de subida
			this.sendMessageWithFile.bind(this)
		);
		this.app.getAppServer().delete( `${this.route}/messages/:messageId`, authMiddleware, this.deleteMessage.bind(this));
		this.app.getAppServer().get( `${this.route}/messages/unread`, authMiddleware, this.getUnreadConversations.bind(this));
	}
	// Método para enviar un mensaje a través de HTTP
	private async sendMessage(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { content, receiverId, isGroupMessage, groupId } = req.body;
			const senderId = req.userId;

			if (!senderId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			// Crear el mensaje
			const newMessage = new this.messageModel({
				sender: senderId,
				receiver: isGroupMessage ? null : receiverId,
				content,
				isGroupMessage,
				groupId,
			});

			const savedMessage = await newMessage.save();

			// Opcional: Puedes emitir un evento si lo deseas
			// Pero es mejor manejarlo en SocketController

			return res.status(StatusCodes.CREATED).json({ message: savedMessage });
		} catch (error) {
			console.error('Error al enviar el mensaje:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al enviar el mensaje', error });
		}
	}
	// Método para obtener mensajes de un usuario específico
	private async getMessages(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { userId } = req.params;
			const currentUserId = req.userId;
			const { skip = 0, limit = 10 } = req.query;

			const messages = await this.messageModel
			.find({
				$or: [
					{ sender: currentUserId, receiver: userId },
					{ sender: userId, receiver: currentUserId },
				],
			})
			.sort({ createdAt: -1 }) // Orden descendente
			.skip(Number(skip))
			.limit(Number(limit))
			.populate({
				path: 'sender',
				select: 'username',
				populate: {
					path: 'profile',
					select: 'profilePicture',
				},
			})
			.select('sender receiver content isGroupMessage groupId isRead createdAt filePath fileType')
			.exec();

			return res.status(StatusCodes.OK).json({ messages });
		} catch (error) {
			console.error('Error al obtener los mensajes:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener los mensajes', error });
		}
	}
	// Método para obtener mensajes de un grupo específico
	private async getGroupMessages(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { groupId } = req.params;
			const messages = await this.messageModel
			.find({ groupId: groupId, isGroupMessage: true })
			.sort({ createdAt: -1 })
			.limit(10)
			.populate({
				path: 'sender',
				select: 'username',
				populate: {
					path: 'profile',
					select: 'profilePicture',
				},
			})
			.exec();

			// Revertir el orden para que estén en orden cronológico
			messages.reverse();
			return res.status(StatusCodes.OK).json({ messages });
		} catch (error) {
			console.error('Error al obtener los mensajes del grupo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener los mensajes del grupo', error });
		}
	}
	// Método para marcar los mensajes como leídos
	private async markAsRead(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { messageId } = req.body;

			const message = await this.messageModel.findByIdAndUpdate(messageId, { isRead: true }, { new: true });

			if (!message) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Mensaje no encontrado' });
			}

			// Opcional: Emitir un evento si es necesario

			return res.status(StatusCodes.OK).json({ message });
		} catch (error) {
			console.error('Error al marcar el mensaje como leído:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al marcar el mensaje como leído', error });
		}
	}
	// Nuevo método para enviar mensajes con archivo
	private async sendMessageWithFile(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { content, receiverId, isGroupMessage, groupId } = req.body;
			const senderId = req.userId;
			const file = req.file;

			const isGroup = isGroupMessage === 'true' || isGroupMessage === true;
			/*		console.log('Datos recibidos en sendMessageWithFile:', {
					content,
					receiverId,
					isGroupMessage,
					groupId,
					senderId,
file: req.file,
});a*/
			if (!senderId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			if (!file && !content) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Debe proporcionar un mensaje o un archivo' });
			}

			const newMessageData: any = {
				sender: senderId,
				receiver: isGroup ? null : receiverId,
				content: content || '',
				isGroupMessage: isGroup,
				groupId: isGroup ? groupId : undefined,
				isRead: false,
			};

			if (file) {
				newMessageData.filePath = file.path;
				newMessageData.fileType = file.mimetype;
			}

			let newMessage = new this.messageModel(newMessageData);
			let savedMessage = await newMessage.save();

			// Popula el sender para incluir la imagen de perfil
			// Popula tanto el sender como el receiver
			savedMessage = await savedMessage.populate([
				{
					path: 'sender',
					select: 'username',
					populate: {
						path: 'profile',
						select: 'profilePicture',
					},
				},
				{
					path: 'receiver',
					select: 'username',
					populate: {
						path: 'profile',
						select: 'profilePicture',
					},
				},
			]);

			// Llamar al método emitMessage del SocketController
			if (isGroup) {
				await this.socketController.emitMessage(savedMessage, true, undefined, groupId);
			} else {
				await this.socketController.emitMessage(savedMessage, false, receiverId);
			}

			return res.status(StatusCodes.CREATED).json({ message: savedMessage });
		} catch (error) {
			console.error('Error al enviar el mensaje con archivo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al enviar el mensaje', error });
		}
	}
	private async deleteMessage(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { messageId } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			if (!messageId || !Types.ObjectId.isValid(messageId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'ID de mensaje inválido' });
			}

			// Buscar el mensaje
			const message = await this.messageModel.findById(messageId);

			if (!message) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Mensaje no encontrado' });
			}

			// Verificar si el usuario está autorizado para eliminar el mensaje
			if (message.sender.toString() !== userId /* && !userIsAdmin */) {
				return res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para eliminar este mensaje' });
			}

			// Eliminar el mensaje
			await message.deleteOne();

			// Emitir un evento a través del socket para notificar a los clientes
			await this.socketController.emitMessageDeletion(
				messageId,
				message.isGroupMessage,
				message.receiver?.toString(),
				message.groupId?.toString()
			);

			return res.status(StatusCodes.OK).json({ message: 'Mensaje eliminado exitosamente' });
		} catch (error) {
			console.error('Error al eliminar el mensaje:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar el mensaje', error });
		}
	}
	private async getUnreadConversations(req: AuthRequest, res: Response) {
		try {
			const userId = req.userId!;
			/* ❶ Mensajes que aún NO ha leído el usuario */

			const pipeline: PipelineStage[] = [
				{
					$match: {
						receiver: new Types.ObjectId(userId),
						isRead: false,
					},
				},

				{ $sort: { createdAt: -1 } },

				{
					$group: {
						_id: '$sender',
						lastMessage: { $first: '$content' },
						createdAt:  { $first: '$createdAt' },
						unread:     { $sum: 1 },
					},
				},

				{
					$lookup: {
						from: 'users',
						localField: '_id',
						foreignField: '_id',
						as: 'user',
					},
				},
				{ $unwind: '$user' },

				{
					$project: {
						_id: 1,
						isGroup: { $literal: false },
						lastMessage: 1,
						createdAt: 1,
						unread: 1,
						user: {
							_id: '$user._id',
							username: '$user.username',
							profile: '$user.profile',
						},
					},
				},

				{ $limit: 10 },
			];

			const conversations = await this.messageModel.aggregate(pipeline).exec();
			return res.status(StatusCodes.OK).json({ conversations });
		} catch (err) {
			console.error(err);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al obtener conversaciones', err });
		}
	}
private async getConversations(req: AuthRequest, res: Response) {
  try {
    const currentUserId = req.userId!;
    const mongoose = this.app.getClientMongoose();
    const User = UserModel(mongoose);

    // paginación opcional
    const skip = Number(req.query.skip ?? 0);
    const limit = Number(req.query.limit ?? 30); // por defecto 30

    // 1) Traer amigos del usuario
    const me = await User.findById(currentUserId).select('friends').lean();
    const friendIds = (me?.friends ?? []).map((f: any) => new Types.ObjectId(String(f)));

    if (!friendIds.length) {
      return res.status(StatusCodes.OK).json({ conversations: [] });
    }

    // 2 Agregación ultimo mensaje y no leídos por peer (solo DMs, no grupos)
    const pipeline: PipelineStage[] = [
      {
        $match: {
          isGroupMessage: false,
          $or: [
            { sender: new Types.ObjectId(currentUserId), receiver: { $in: friendIds } },
            { receiver: new Types.ObjectId(currentUserId), sender: { $in: friendIds } },
          ],
        },
      },
      { $sort: { createdAt: -1 } }, // para que $first tome el último mensaje
      {
        $group: {
          _id: {
            // peerId = si YO soy el sender => el receiver; en otro caso => el sender
            $cond: [
              { $eq: ['$sender', new Types.ObjectId(currentUserId)] },
              '$receiver',
              '$sender',
            ],
          },
          lastMessage: { $first: '$$ROOT' },
          lastMessageAt: { $first: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiver', new Types.ObjectId(currentUserId)] },
                    { $eq: ['$isRead', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'peer',
        },
      },
      { $unwind: '$peer' },
      {
        $project: {
          _id: 0,
          peer: {
            _id: '$peer._id',
            username: '$peer.username',
            profile: '$peer.profile',
          },
          lastMessageAt: 1,
          unreadCount: 1,
          lastMessage: {
            content: '$lastMessage.content',
            createdAt: '$lastMessage.createdAt',
            sender: '$lastMessage.sender',
            filePath: '$lastMessage.filePath',
            fileType: '$lastMessage.fileType',
          },
        },
      },
      { $sort: { lastMessageAt: -1 } },
      ...(skip ? [{ $skip: skip }] : []),
      ...(limit ? [{ $limit: limit }] : []),
    ];

    const conversations = await this.messageModel.aggregate(pipeline).exec();

    // 3) Agregar amigos sin mensajes (al final)
    const withMsgs = new Set(conversations.map((c: any) => String(c.peer._id)));
    const friendsWithoutMsgs = friendIds.filter((fid) => !withMsgs.has(String(fid)));
    if (friendsWithoutMsgs.length) {
      const rest = await User.find({ _id: { $in: friendsWithoutMsgs } })
        .select('_id username profile')
        .lean();
    }

    return res.status(StatusCodes.OK).json({ conversations });
  } catch (error) {
    console.error('Error getConversations:', error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'Error al obtener conversaciones', error });
  }
}


}

export default MessageController;

