// src/routes/socket.ts
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken } from '../authentication/authUser';
import { MessageModel, IMessage } from './schemas/message';
import { GroupModel } from './schemas/group';
import { IUser } from './schemas/user';
import { StreamModel, IStream } from './schemas/stream';
import { Model } from 'mongoose';
import { UserModel } from './schemas/user';
import { ICareer } from './schemas/career';
import { CareerModel } from './schemas/career';
import App from '../app';


interface AuthenticatedSocket extends Socket {
	data: {
		userId?: string;
	};
}

export class SocketController {
	private io: SocketIOServer;
	private connectedUsers: Map<string, string>;
	private bannedViewers: Map<string, Set<string>> = new Map();
	private messageModel: ReturnType<typeof MessageModel>;
	private groupModel: ReturnType<typeof GroupModel>;
	private streamModel: Model<IStream>
	private userModel: ReturnType<typeof UserModel>;
	private streamViewers: Map<string, Set<string>> = new Map();

	constructor(io: SocketIOServer, app: App) {
		this.io = io;
		this.connectedUsers = new Map();
		this.userModel = UserModel(app.getClientMongoose());
		this.messageModel = MessageModel(app.getClientMongoose());
		this.groupModel = GroupModel(app.getClientMongoose());
		this.streamModel = StreamModel;
		this.initializeSocketEvents();
	}

	private initializeSocketEvents(): void {
		// Middleware de autenticación de Socket.IO
		this.io.use((socket: AuthenticatedSocket, next) => {
			const token = socket.handshake.auth.token;
			console.log('[SOCKET] token recibido:', token);   // ← añade esto

			if (!token) {
				console.error('Token no proporcionado en la conexión de Socket.IO');
				return next(new Error('Authentication error'));
			}
			try {
				const payload = verifyToken(token);
				socket.data.userId = payload.userId;
				next();
			} catch (error) {
				console.error('Token inválido en la conexión de Socket.IO:', error);
				next(new Error('Invalid token'));
			}
		});

		// Manejo de eventos de conexión
		this.io.on('connection', (socket: AuthenticatedSocket) => {
			const userId = socket.data.userId
			if (!userId) return;

			console.log(`Usuario conectado: ${userId} con socket ID: ${socket.id}`);
			// Guardar usuario conectado
			if (this.connectedUsers.has(userId))
				console.log('[BACK] reemplazando socket previo de', userId);
			this.connectedUsers.set(userId, socket.id);
			console.log('[BACK] set connected', userId, socket.id);
			console.log('[BACK] map keys →', Array.from(this.connectedUsers.keys()));


			// Escuchar el evento para unirse a una sala
			socket.on('join-room', (roomId: string) => {
				socket.join(roomId);
				console.log(`Usuario ${userId} se unió a la sala ${roomId}`);
			});

			// Evitar registrar eventos múltiples veces
			if ((socket as any).eventsRegistered) {
				console.warn(`Eventos ya registrados para el socket ${socket.id}`);
			} else {
				// Registrar eventos
				this.initializeMessageEvents(socket);
				this.initializeStreamEvents(socket);
				(socket as any).eventsRegistered = true;
			}

			// Manejar desconexión
			socket.on('disconnect', () => {
				console.log(`Usuario desconectado: ${userId}`);
				this.connectedUsers.delete(userId);
			});
		});
	}

	private initializeMessageEvents(socket: AuthenticatedSocket): void {
		console.log(`Inicializando eventos para el socket ${socket.id} del usuario ${socket.data.userId}`)
		socket.on('send-message', async (data) => {
			console.log(`Evento 'send-message' recibido en socket ${socket.id} con datos:`, data);
			try {
				const { content, receiverId, isGroupMessage, groupId } = data;
				const senderId = socket.data.userId;
				console.log('Datos del mensaje recibido en send-message:', {
					senderId,
					receiverId,
					isGroupMessage,
					groupId,
				});
				// Validar datos
				if (!senderId || (isGroupMessage && !groupId) || (!isGroupMessage && !receiverId)) {
					console.error('Faltan senderId o receiverId/groupId');
					return;
				}

				// Crear el mensaje
				const newMessage = new this.messageModel({
					sender: senderId,
					receiver: isGroupMessage ? null : receiverId,
					content,
					isGroupMessage,
					groupId,
				});
				console.log('Mensaje recibido del cliente:', {
					content,
					receiverId,
					isGroupMessage,
					groupId,
					senderId,
				});

				let savedMessage = await newMessage.save();

				// Popula el sender para incluir la imagen de perfil
				savedMessage = await savedMessage.populate({
					path: 'sender',
					select: 'username',
					populate: {
						path: 'profile',
						select: 'profilePicture',
					},
				});
				//await this.emitMessage(savedMessage, isGroupMessage, receiverId, groupId);
				// Convertir savedMessage a IMessage
				const populatedMessage = savedMessage as IMessage;
				console.log('Mensaje guardado y populado:', populatedMessage);

				// Emitir el mensaje a los usuarios conectados
				if (isGroupMessage) {
					// Obtener el grupo y emitir a cada miembro
					const group = await this.groupModel.findById(groupId).populate('members');
					if (!group) {
						console.error('Grupo no encontrado');
						return;
					}

					group.members.forEach((member: any) => {
						const memberId = member._id.toString();
						const memberSocketId = this.connectedUsers.get(memberId);
						if (memberSocketId) {
							this.io.to(memberSocketId).emit('receive-message', populatedMessage);
							// Emitir notificación a cada miembro del grupo
							this.io.to(memberSocketId).emit('new-notification', {
								message: `Nuevo mensaje en el grupo ${group.name}`,
								type: 'group-message',
								data: populatedMessage,
							});
						}
					});
				} else {
					// Lógica para mensajes privados
					if (!receiverId) {
						console.error('receiverId is undefined for a private message.');
						return;
					}
					const receiverSocketId = this.connectedUsers.get(receiverId);
					console.log(`Buscando socket del receptor ${receiverId}: ${receiverSocketId}`);
					if (receiverSocketId) {
						console.log(`Emitiendo mensaje al receptor ${receiverId} en socket ${receiverSocketId}`);
						const sender = populatedMessage.sender as IUser;
						this.io.to(receiverSocketId).emit('receive-message', populatedMessage);
						// Emitir una notificación para mensajes privados
						this.io.to(receiverSocketId).emit('new-notification', {
							message: `Nuevo mensaje de ${sender.username}`,
							type: 'message',
							data: populatedMessage,
						});
					} else {
						console.warn(`Usuario destino ${receiverId} no está conectado.`);
					}
				}
			} catch (error) {
				console.error('Error al enviar el mensaje:', error);
			}
		});

		// Otros eventos relacionados con mensajes pueden ir aquí
	}

	// Método público para emitir mensajes
	public async emitMessage(
		savedMessage: IMessage,
		isGroup: boolean,
		receiverId?: string,
		groupId?: string
	): Promise<void> {
		const populatedMessage = savedMessage as IMessage;
		const senderId = populatedMessage.sender._id.toString()
		// Emitir el mensaje al remitente
		const senderSocketId = this.connectedUsers.get(senderId);
		if (senderSocketId) {
			console.log(`Emitiendo mensaje al remitente ${senderId} en socket ${senderSocketId}`);
			this.io.to(senderSocketId).emit('receive-message', populatedMessage);
		}
		if (isGroup) {
			// Lógica para mensajes grupales
			const group = await this.groupModel.findById(groupId).populate('members');
			if (!group) {
				console.error('Grupo no encontrado');
				return;
			}

			group.members.forEach((member: any) => {
				const memberId = member._id.toString();
				const memberSocketId = this.connectedUsers.get(memberId);
				if (memberSocketId) {
					this.io.to(memberSocketId).emit('receive-message', populatedMessage);
					this.io.to(memberSocketId).emit('new-notification', {
						message: `Nuevo mensaje en el grupo ${group.name}`,
						type: 'group-message',
						data: populatedMessage,
					});
				}
			});
		} else {
			// Lógica para mensajes privados
			// Lógica para mensajes privados
			if (!receiverId) {
				receiverId = populatedMessage.receiver?._id.toString();
				if (!receiverId) {
					console.error('receiverId is undefined for a private message.');
					return;
				}
			}

			console.log(`receiverId: ${receiverId}`);
			const receiverSocketId = this.connectedUsers.get(receiverId);
			if (receiverSocketId) {
				const sender = populatedMessage.sender as IUser;
				console.log(`Emitiendo mensaje al receptor ${receiverId} en socket ${receiverSocketId}`);
				this.io.to(receiverSocketId).emit('receive-message', populatedMessage);
				this.io.to(receiverSocketId).emit('new-notification', {
					message: `Nuevo mensaje de ${sender.username}`,
					type: 'message',
					data: populatedMessage,
				});
			} else {
				console.warn(`Usuario destino ${receiverId} no está conectado.`);
			}

		}
	}
	// Método para obtener el socketId de un usuario
	public getSocketId(userId: string): string | undefined {
		return this.connectedUsers.get(userId);
	}

	// Método público para emitir notificaciones a un usuario
	public emitNotification(userId: string, notificationData: any): void {
		const socketId = this.connectedUsers.get(userId);
		if (socketId) {
			this.io.to(socketId).emit('new-notification', notificationData);
		} else {
			console.log(`Usuario ${userId} no está conectado.`);
		}
	}

	// Método público para emitir eventos a una sala específica
	public emitToRoom(roomId: string, eventName: string, data: any): void {
		this.io.to(roomId).emit(eventName, data);
	}

	private initializeStreamEvents(socket: AuthenticatedSocket): void {
		const userId = socket.data.userId;
		if (!userId) return;

		// Unirse a la sala de stream
		socket.on('join-stream', async (data) => {
			console.log('Datos recibidos en join-stream:', data);
			const { streamId, accessCode } = data;
			const userId = socket.data.userId;
			console.log('[SOCKET] join-stream', { streamId, userId });
			console.log('   streamViewers antes:', this.streamViewers.get(streamId));

			if (!userId) {
				socket.emit('stream-error', { message: 'Usuario no autenticado' });
				return;
			}
			/* ───── 1.  ¿está vetado?  ───────────────────────────── */
			if (this.bannedViewers.get(streamId)?.has(userId)) {
				socket.emit('stream-error',
							{ message: 'Has sido expulsado de este stream' });
							return;                                // ⬅️  no seguimos
			}
			try {
				const stream = await this.streamModel.findById(streamId);
				if (!stream || !stream.active) {
					socket.emit('stream-error', { message: 'El stream no está disponible' });
					return;
				}

				let canJoin = false;
				const banned = this.bannedViewers.get(streamId);
				if (banned?.has(userId)) {
					socket.emit('stream-error', { message: 'Has sido expulsado de este stream.' });
					return;
				}
				if (stream.visibility === 'university') {
					canJoin = true;
				} else if (stream.visibility === 'career') {
					// Verificar si el usuario pertenece a las carreras permitidas
					const user = await this.userModel.findById(userId).populate('careers').exec();

					if (!user) {
						socket.emit('stream-error', { message: 'Usuario no encontrado' });
						return;
					}

					// En este punto, user.careers sigue tipado como ICareer['_id'][] (ObjectId[]),
					// pero realmente contiene ICareer[] gracias a populate.
					// Hacemos una aserción de tipo para tratar user.careers como ICareer[]:
					const userCareerIds = (user.careers as unknown as ICareer[]).map((career: ICareer) => career._id.toString());

					if (!stream.careerIds || stream.careerIds.length === 0) {
						socket.emit('stream-error', { message: 'El stream no tiene carreras asociadas' });
						return;
					}

					const streamCareerIds = stream.careerIds.map((id) => id.toString());

					// Verificar si hay intersección entre las carreras del usuario y las del stream
					canJoin = userCareerIds.some((careerId) => streamCareerIds.includes(careerId));

				} else if (stream.visibility === 'private') {
					if (userId === stream.userId.toString()) {
						// El usuario es el propietario del stream
						canJoin = true;
					} else if (accessCode === stream.accessCode) {
						canJoin = true;
					} else {
						socket.emit('stream-error', { message: 'Código de acceso incorrecto' });
						return;
					}
				}

				if (canJoin) {
					socket.join(streamId);
					console.log(`Usuario ${userId} se unió al stream ${streamId}`);
					const ownerId = stream.userId.toString();          // <— usa SIEMPRE string
					const ownerSocketId = this.connectedUsers.get(ownerId);
					console.log('[BACK] ownerSocketId =', ownerSocketId);
					if (ownerSocketId) {
						console.log('[BACK] emitir request-screen-share a', ownerSocketId);
						// antes de emitir request-screen-share
						console.log('[BACK] stream.userId', stream.userId.toString());
						console.log('[BACK] map has key ?', this.connectedUsers.has(stream.userId.toString()));
						console.log('[BACK] connectedUsers keys', Array.from(this.connectedUsers.keys()));
						this.io.to(ownerSocketId).emit('request-screen-share', {
							viewerSocketId: socket.id,           // a quién va dirigido
							streamId
						});
					}
					// Agregar a la lista de espectadores
					if (!this.streamViewers.has(streamId)) {
						this.streamViewers.set(streamId, new Set());
					}
					this.streamViewers.get(streamId)!.add(userId);
					// Notificar al streamer que la lista de espectadores ha cambiado
					await this.updateStreamerViewersList(streamId);
				} else {
					socket.emit('stream-error', { message: 'No tienes permiso para unirte a este stream' });
				}
			} catch (error) {
				console.error('Error al unirse al stream:', error);
				socket.emit('stream-error', { message: 'Error al unirse al stream' });
			}
		});


		// Manejo de oferta WebRTC
		socket.on('offer', (streamId: string, offer: any) => {
			socket.to(streamId).emit('offer', offer); // Emitir oferta a los demás
		});

		// Manejo de respuesta WebRTC
		socket.on('answer', (streamId: string, answer: any) => {
			socket.to(streamId).emit('answer', answer); // Emitir respuesta a los demás
		});

		// Manejo de candidatos ICE
		socket.on('ice-candidate', (streamId: string, candidate: any) => {
			socket.to(streamId).emit('ice-candidate', candidate); // Emitir candidato ICE
		});

		socket.on('screen-share-offer', ({ streamId, offer, to }) => {
			if (to) {
				// ① oferta dirigida (re-offer)
				socket.to(to).emit('screen-share-offer', { offer });
			} else {
				// ② oferta inicial (broadcast)
				socket.to(streamId).emit('screen-share-offer', { offer });
			}
		});

		socket.on('screen-share-answer', d => {
			const { streamId, answer } = d;
			socket.to(streamId).emit('screen-share-answer', { answer });
		});
		socket.on('screen-share-ice',   d => {
			const { streamId, candidate } = d;
			socket.to(streamId).emit('screen-share-ice',    { candidate });
		});

		/* ④ Fin de pantalla ------------------------------ */
		socket.on('stop-screen-share',  d => {
			const { streamId } = d;
			socket.to(streamId).emit('stop-screen-share');        // sin payload
		});


		// Evento para expulsar a un espectador
		socket.on('kick-viewer', async ({ streamId, viewerId }) => {
			const stream = await this.streamModel.findById(streamId);
			if (!stream || stream.userId.toString() !== userId) {
				socket.emit('action-error', { message: 'No tienes permiso' });
				return;
			}

			/* ①  añadir a la lista negra */
			this.banViewer(streamId, viewerId);

			/* ②  notificar al expulsado y cerrar su socket */
			const viewerSocketId = this.connectedUsers.get(viewerId);
			if (viewerSocketId) {
				this.io.to(viewerSocketId).emit('kicked',
												{ message: 'Has sido expulsado del stream.' });
												this.io.sockets.sockets.get(viewerSocketId)?.leave(streamId);
			}

			/* ③  actualizar estructuras y avisar al streamer */
			this.streamViewers.get(streamId)?.delete(viewerId);
			await this.updateStreamerViewersList(streamId);

			/* ④  limpiar mapa si ya no quedan */
			if (this.streamViewers.get(streamId)?.size === 0) {
				this.streamViewers.delete(streamId);
			}
			if (!this.bannedViewers.has(streamId))
				this.bannedViewers.set(streamId, new Set());
			this.bannedViewers.get(streamId)!.add(viewerId);
		});

		// Evento para que el espectador salga voluntariamente del stream
		socket.on('leave-stream', async (data) => {
			const { streamId } = data;

			// Remover al usuario de la lista de espectadores
			const viewersSet = this.streamViewers.get(streamId);
			if (viewersSet) {
				viewersSet.delete(userId);
			}

			// Dejar la sala del stream
			socket.leave(streamId);

			// Notificar al streamer que la lista de espectadores ha cambiado
			await this.updateStreamerViewersList(streamId);
		});

		socket.on('disconnect', () => {
			console.log(`Usuario desconectado: ${userId}`);
			// Remover al usuario de todos los streams a los que estaba unido
			this.streamViewers.forEach((viewersSet, streamId) => {
				if (viewersSet.has(userId)) {
					viewersSet.delete(userId);
					// Notificar al streamer que la lista de espectadores ha cambiado
					this.updateStreamerViewersList(streamId);
				}
			});
		});
	}

	// Función para actualizar la lista de espectadores y enviarla al streamer
	private async updateStreamerViewersList(streamId: string) {
		const viewersSet = this.streamViewers.get(streamId);
		if (!viewersSet) return;

		// Obtener los detalles de los usuarios
		const userIds = Array.from(viewersSet);
		const users = await this.userModel.find({ _id: { $in: userIds } })
		.select('username')
		.exec();

		// Encontrar el socket del streamer
		const stream = await this.streamModel.findById(streamId);
		if (!stream) return;

		const streamerId = stream.userId.toString();
		const streamerSocketId = this.connectedUsers.get(streamerId);

		if (streamerSocketId) {
			this.io.to(streamerSocketId).emit('update-viewers', { viewers: users });
		}
	}
	public async emitMessageDeletion(
		messageId: string,
		isGroup: boolean,
		receiverId?: string,
		groupId?: string
	): Promise<void> {
		// Emitir a los usuarios correspondientes
		if (isGroup) {
			// Emitir a todos los miembros del grupo
			const group = await this.groupModel.findById(groupId).populate('members');
			if (!group) {
				console.error('Grupo no encontrado');
				return;
			}

			group.members.forEach((member: any) => {
				const memberId = member._id.toString();
				const memberSocketId = this.connectedUsers.get(memberId);
				if (memberSocketId) {
					this.io.to(memberSocketId).emit('message-deleted', { messageId });
				}
			});
		} else {
			// Emitir al receptor
			if (!receiverId) {
				console.error('receiverId is undefined for a private message deletion.');
				return;
			}

			const receiverSocketId = this.connectedUsers.get(receiverId);
			if (receiverSocketId) {
				this.io.to(receiverSocketId).emit('message-deleted', { messageId });
			} else {
				console.warn(`Usuario destino ${receiverId} no está conectado.`);
			}
		}
	}
	public emitToUser(userId: string, event: string, data: any) {
		const sockId = this.connectedUsers.get(userId);
		if (sockId) this.io.to(sockId).emit(event, data);
	}
	// src/routes/socket.ts  (dentro de la clase SocketController)

	public getViewers(streamId: string): Set<string> | undefined {
		return this.streamViewers.get(streamId);
	}
	private banViewer(streamId: string, userId: string) {
		if (!this.bannedViewers.has(streamId))
			this.bannedViewers.set(streamId, new Set());
		this.bannedViewers.get(streamId)!.add(userId);
	}

}

export default SocketController;

