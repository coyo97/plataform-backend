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
  console.log('[[STREAM]] join-stream: socket.id=%s userId=%s data=%o', socket.id, userId, data);

  if (!userId) {
    socket.emit('stream-error', { message: 'Usuario no autenticado' });
    return;
  }

  // 1) veto
  if (this.bannedViewers.get(streamId)?.has(userId)) {
    socket.emit('stream-error', { message: 'Has sido expulsado de este stream' });
    return;
  }

  try {
    const stream = await this.streamModel.findById(streamId);
    console.log(
      '[[STREAM]] stream %s active=%s visibility=%s owner=%s',
      streamId, !!stream?.active, stream?.visibility, stream?.userId?.toString()
    );

    if (!stream || !stream.active) {
      socket.emit('stream-error', { message: 'El stream no está disponible' });
      return;
    }

    // 2) autorizaciones
    let canJoin = false;

    if (stream.visibility === 'university') {
      canJoin = true;
    } else if (stream.visibility === 'career') {
      const user = await this.userModel.findById(userId).populate('careers').exec();
      if (!user) {
        socket.emit('stream-error', { message: 'Usuario no encontrado' });
        return;
      }
      const userCareerIds = (user.careers as any[]).map(c => c._id.toString());
      const streamCareerIds = (stream.careerIds ?? []).map((id: any) => id.toString());
      if (streamCareerIds.length === 0) {
        socket.emit('stream-error', { message: 'El stream no tiene carreras asociadas' });
        return;
      }
      canJoin = userCareerIds.some(id => streamCareerIds.includes(id));
    } else if (stream.visibility === 'private') {
      if (userId === stream.userId.toString()) canJoin = true;
      else if (accessCode === stream.accessCode) canJoin = true;
      else {
        socket.emit('stream-error', { message: 'Código de acceso incorrecto' });
        return;
      }
    }

    if (!canJoin) {
      socket.emit('stream-error', { message: 'No tienes permiso para unirte a este stream' });
      return;
    }

    // 3) unir a sala (evita doble join)
    if (!socket.rooms.has(streamId)) {
      console.log('[[ROOM]] socket.join(%s) by user=%s', streamId, userId);
      socket.join(streamId);
    }
    console.log(`Usuario ${userId} se unió al stream ${streamId}`);

    // 4) snapshot de estado al recién llegado (SOLO una vez)
    const isSharingScreen = this.activeScreenStreams?.has(streamId) ?? false;
    const streamerMuted = this.mutedStreamers?.has(streamId) ?? false;
    this.io.to(socket.id).emit('current-stream-state', {
      isSharingScreen,
      isStreamerMuted: streamerMuted,
      viewersCount: this.streamViewers.get(streamId)?.size ?? 0,
    });
    console.log(
      '[[STATE]] current-stream-state emitido a %s: { isSharingScreen=%s, muted=%s }',
      socket.id, isSharingScreen, streamerMuted
    );

    // 5) owner actual
    const ownerId = stream.userId.toString();
    const ownerSocketId = this.connectedUsers.get(ownerId);
    const isOwnerSelf = ownerId === userId && ownerSocketId === socket.id;
    console.log('[BACK] ownerSocketId =', ownerSocketId, 'isOwnerSelf=', isOwnerSelf);

    // 6) enviar stream-owner AL QUE ENTRA (una sola vez)
    this.io.to(socket.id).emit('stream-owner', { ownerSocketId });
    console.log('[[STATE]] stream-owner → %s ownerSocketId=%s', socket.id, ownerSocketId);

    // 7) preparar set de viewers y agregar (no agregues al dueño)
    if (!this.streamViewers.has(streamId)) {
      this.streamViewers.set(streamId, new Set());
    }
    if (!isOwnerSelf) {
      this.streamViewers.get(streamId)!.add(userId);
      console.log(
        '[[VIEWERS]] add user=%s to stream=%s size=%d',
        userId, streamId, this.streamViewers.get(streamId)!.size
      );
    } else {
      console.log('[[VIEWERS]] owner no se agrega al set de viewers');
    }

    // 8) notificar al owner del late-join SOLO si no es el mismo socket
    if (ownerSocketId && ownerSocketId !== socket.id) {
      console.log(
        '[[SIG]] late-join notify owner: ownerId=%s ownerSocketId=%s viewerSocketId=%s',
        ownerId, ownerSocketId, socket.id
      );
      this.io.to(ownerSocketId).emit('request-screen-share', {
        viewerSocketId: socket.id,
        streamId,
      });
      this.io.to(ownerSocketId).emit('request-offer', {
        viewerSocketId: socket.id,
        streamId,
      });
    } else if (ownerSocketId === socket.id) {
      console.log('[[STATE]] owner joined; skip late-join notifies to self');
    }

    // 9) actualizar lista al streamer (una sola vez)
    await this.updateStreamerViewersList(streamId);

  } catch (error) {
    console.error('Error al unirse al stream:', error);
    socket.emit('stream-error', { message: 'Error al unirse al stream' });
    console.error('[[ERR]] join-stream failed: streamId=%s userId=%s err=%o', streamId, userId, error);
  }
});


		// Permite que un viewer tarde pida pantalla aunque el streamer ya esté compartiendo.
socket.on('request-screen-share', async ({ streamId, viewerSocketId }: { streamId: string; viewerSocketId?: string }) => {
  try {
    const stream = await this.streamModel.findById(streamId);
    if (!stream) return;

    const ownerId = stream.userId.toString();
    const ownerSocketId = this.connectedUsers.get(ownerId);

    // si no viene viewerSocketId, usamos el socket emisor
    const requester = viewerSocketId || socket.id;

    // ① SIEMPRE informar al requester quién es el owner (puede ser undefined)
    this.io.to(requester).emit('stream-owner', { ownerSocketId });

    // ② Si el owner está online y NO es el mismo socket, notifícale el late-join
    if (ownerSocketId && ownerSocketId !== requester) {
      this.io.to(ownerSocketId).emit('request-screen-share', { viewerSocketId: requester, streamId });
      this.io.to(ownerSocketId).emit('request-offer',       { viewerSocketId: requester, streamId });
    }

    console.log('[[SIG]] request-screen-share relay -> ownerId=%s ownerSocketId=%s requester=%s',
      ownerId, ownerSocketId, requester);
  } catch (err) {
    console.error('[SOCKET] request-screen-share relay error:', err);
    socket.emit('stream-error', { message: 'Error al solicitar pantalla' });
  }
});
	

		/* ════════════════ CHAT EN VIVO DEL STREAM ════════════════ */
		socket.on('stream-chat-message', async ({ streamId, toUserId, content }) => {
			const senderId = socket.data.userId;
			if (!senderId || !content) return;

			const user = await this.userModel
			.findById(senderId)
			.select('username profile')
			.populate('profile');

			const msg = {
				senderId,
				username: user?.username,
				profilePicture: (user as any)?.profile?.profilePicture,
				content,
				timestamp: Date.now(),
				toUserId,
			};

			if (toUserId) {
				const dst = this.connectedUsers.get(toUserId);
				const src = this.connectedUsers.get(senderId);
				if (dst) this.io.to(dst).emit('stream-chat-message', msg);
				if (src) this.io.to(src).emit('stream-chat-message', msg);
			} else {
				this.io.to(streamId).emit('stream-chat-message', msg);
			}
		});

		/* ───────── backend: ruteo genérico ───────── */
// OFFER
// OFFER — SIEMPRE dirigido
socket.on('offer', ({ streamId, to, offer }) => {
  if (!to) {
    console.warn('[[GUARD]] offer sin `to`, se descarta', { from: socket.id, streamId });
    socket.emit('sig-error', { type: 'offer', reason: 'missing-to', streamId });
    return;
  }
  if (to === socket.id) {
    console.warn('[[GUARD]] ignoring self-offer to same socket', { streamId, to });
    return;
  }

  console.log('[[SIG]] offer: from=%s to=%s streamId=%s', socket.id, to, streamId);
  // Relay dirigido (no usar broadcast a la sala)
  socket.to(to).emit('offer', { from: socket.id, offer, streamId });
});

// ANSWER — SIEMPRE dirigido
socket.on('answer', ({ streamId, to, answer }) => {
  if (!to) {
    console.warn('[[GUARD]] answer sin `to`, se descarta', { from: socket.id, streamId });
    socket.emit('sig-error', { type: 'answer', reason: 'missing-to', streamId });
    return;
  }
  if (to === socket.id) {
    console.warn('[[GUARD]] ignoring self-answer to same socket', { streamId, to });
    return;
  }

  console.log('[[SIG]] answer: from=%s to=%s streamId=%s', socket.id, to, streamId);
  socket.to(to).emit('answer', { from: socket.id, answer, streamId });
});

// ICE — SIEMPRE dirigido
socket.on('ice-candidate', ({ streamId, to, candidate }) => {
  if (!to) {
    console.warn('[[GUARD]] ice sin `to`, se descarta', { from: socket.id, streamId });
    socket.emit('sig-error', { type: 'ice', reason: 'missing-to', streamId });
    return;
  }
  if (to === socket.id) {
    console.warn('[[GUARD]] ignoring self-ice to same socket', { streamId, to });
    return;
  }

  const hasCandidate = !!candidate;
  console.log('[[ICE]] candidate: from=%s to=%s streamId=%s hasCandidate=%s',
              socket.id, to, streamId, hasCandidate);

  socket.to(to).emit('ice-candidate', { from: socket.id, candidate, streamId });
});


// SCREEN-SHARE OFFER
// SCREEN-SHARE OFFER (reemplaza tu handler actual)
// SCREEN-SHARE OFFER: admite target directo (to) o broadcast (sin to)
// SCREEN-SHARE OFFER (propaga `origin`)
socket.on('screen-share-offer', ({ streamId, offer, to, origin }) => {
  if (to && to === socket.id) {
    console.warn('[[GUARD]] self-target in screen-share-offer', { streamId, to });
    return;
  }

  if (to) {
    // Target directo (recomendado para SFU ligero)
    console.log(
      '[[SIG]] screen-share-offer (target): from=%s to=%s origin=%s streamId=%s',
      socket.id, to, origin ?? '(none)', streamId
    );
    socket.to(to).emit('screen-share-offer', { offer, from: socket.id, origin });
  } else {
    // Broadcast a la sala (menos recomendado)
    console.log(
      '[[SIG]] screen-share-offer (broadcast): from=%s origin=%s streamId=%s',
      socket.id, origin ?? '(none)', streamId
    );
    socket.to(streamId).emit('screen-share-offer', { offer, from: socket.id, origin });
  }
});

// SCREEN-SHARE ANSWER: siempre dirigido (propaga `origin` para simetría/depuración)
socket.on('screen-share-answer', ({ streamId, to, answer, origin }) => {
  if (!to || to === socket.id) {
    console.warn('[[GUARD]] invalid screen-share-answer target', { streamId, to });
    socket.emit('screen-share-error', { streamId, message: 'missing or invalid "to" in screen-share-answer' });
    return;
  }
  console.log(
    '[[SIG]] screen-share-answer: from=%s to=%s origin=%s streamId=%s',
    socket.id, to, origin ?? '(none)', streamId
  );
  socket.to(to).emit('screen-share-answer', { answer, from: socket.id, origin });
});

// SCREEN-SHARE ICE: siempre dirigido (propaga `origin`)
socket.on('screen-share-ice', ({ streamId, to, candidate, origin }) => {
  if (!to || to === socket.id) {
    console.warn('[[GUARD]] invalid screen-share-ice target', { streamId, to });
    socket.emit('screen-share-error', { streamId, message: 'missing or invalid "to" in screen-share-ice' });
    return;
  }
  console.log(
    '[[ICE]] screen-share-ice: from=%s to=%s origin=%s streamId=%s hasCandidate=%s',
    socket.id, to, origin ?? '(none)', streamId, !!candidate
  );
  socket.to(to).emit('screen-share-ice', { candidate, from: socket.id, origin });
});


		/* ④ Fin de pantalla ------------------------------ */
		socket.on('stop-screen-share', ({ streamId }) => {
			socket.to(streamId).emit('stop-screen-share'); // sin payload
			console.log('[[SCREEN]] stop-screen-share broadcast streamId=%s by=%s', streamId, socket.id);

		});

		// Evento para expulsar a un espectador
		socket.on('kick-viewer', async ({ streamId, viewerId }) => {
			console.log('[[ADMIN]] kick-viewer: by=%s streamId=%s targetUser=%s', userId, streamId, viewerId);
			const stream = await this.streamModel.findById(streamId);
			if (!stream || stream.userId.toString() !== userId) {
				socket.emit('action-error', { message: 'No tienes permiso' });
				return;
			}

			// ① añadir a la lista negra
			this.banViewer(streamId, viewerId);

			// ② notificar al expulsado y cerrar su socket
			const viewerSocketId = this.connectedUsers.get(viewerId);
			if (viewerSocketId) {
				this.io.to(viewerSocketId).emit('kicked', { message: 'Has sido expulsado del stream.' });
				this.io.sockets.sockets.get(viewerSocketId)?.leave(streamId);
			}

			// ③ actualizar estructuras y avisar al streamer
			this.streamViewers.get(streamId)?.delete(viewerId);
			await this.updateStreamerViewersList(streamId);

			// ④ limpiar mapa si ya no quedan
			if (this.streamViewers.get(streamId)?.size === 0) {
				this.streamViewers.delete(streamId);
			}
			if (!this.bannedViewers.has(streamId)) this.bannedViewers.set(streamId, new Set());
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
			console.log('[[STREAM]] leave-stream: user=%s streamId=%s', userId, streamId);
console.log('[[ROOM]] socket.leave(%s) by user=%s', streamId, userId);

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
			console.log('[[SOCKET]] disconnect: user=%s socket.id=%s', userId, socket.id);

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

		this.io.to(streamId).emit('viewer-list', { viewers: users });
		if (streamerSocketId) {
			this.io.to(streamerSocketId).emit('update-viewers', {streamId, viewers: users });
		}
		this.io.emit('viewer-count', {        
			streamId,
			viewerCount: users.length,
		});	
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
private activeScreenStreams: Set<string> = new Set(); // streamIds con pantalla activa
private mutedStreamers: Set<string> = new Set();      // streamIds cuyo streamer está silenciado

}

export default SocketController;

