import { Model } from 'mongoose';
import { authMiddleware } from '../middlware/authMiddlewares';
import { Request, Response } from 'express';
import App from '../app';
import { StatusCodes } from 'http-status-codes';
import { StreamModel, IStream } from './schemas/stream';
import { v4 as uuidv4 } from 'uuid'; // Importa uuid
import SocketController from './socket';
import { UserModel } from './schemas/user';
import { dynamicPermissionMiddleware } from '../middlware/permissionMiddleware';

interface AuthRequest extends Request {
	userId?: string;
}
// Al comienzo de src/routes/stream.ts  (fuera de la clase)
//const VIEWERS: Record<string, Set<string>> = {};   // streamId → Set<userId>

export class StreamController {
	private route: string;
	private app: App;
	private streamModel: Model<IStream>;
	private socketController: SocketController;
	private userModel: ReturnType<typeof UserModel>;

	constructor(app: App, route: string,  socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.userModel = UserModel(this.app.getClientMongoose());

		this.streamModel = StreamModel;
		this.socketController = socketController;
		this.initRoutes();
	}

	private initRoutes(): void {
		this.app.getAppServer().get(`${this.route}/streams`, authMiddleware,dynamicPermissionMiddleware, this.getStreams.bind(this));
		this.app.getAppServer().post(`${this.route}/streams`, authMiddleware,dynamicPermissionMiddleware, this.createStream.bind(this));
		this.app.getAppServer().delete(`${this.route}/streams/:streamId`, authMiddleware, this.deleteStream.bind(this));

		// En StreamController constructor o método initRoutes
		this.app.getAppServer().post(`${this.route}/streams/:streamId/shareScreen`, authMiddleware, this.startScreenShare.bind(this));
		this.app.getAppServer().delete(`${this.route}/streams/:streamId/shareScreen`, authMiddleware, this.stopScreenShare.bind(this));

		// Unirse, finalizar, likes y vistas
		this.app.getAppServer().post(`${this.route}/streams/:streamId/join`,  authMiddleware, this.joinStream.bind(this));
		this.app.getAppServer().put (`${this.route}/streams/:streamId/end`,   authMiddleware, this.endStream.bind(this));
		this.app.getAppServer().post(`${this.route}/streams/:streamId/like`,  authMiddleware, this.likeStream.bind(this));
		this.app.getAppServer().post(`${this.route}/streams/:streamId/unlike`,authMiddleware, this.unlikeStream.bind(this));
		this.app.getAppServer().post(`${this.route}/streams/:streamId/view`,  this.incrementViewCount.bind(this)); // sin auth

		this.app.getAppServer().get(`${this.route}/streams/:streamId/viewers`,authMiddleware, this.listViewers.bind(this));
		this.app.getAppServer().post(`${this.route}/streams/:streamId/kick`,authMiddleware,this.kickViewer.bind(this));

	}

	private async getStreams(req: Request, res: Response): Promise<Response> {
		try {
			// Parsear flags de la query (?live=true  / ?ended=true)
			const live   = String(req.query.live   ?? '').toLowerCase() === 'true';
			const ended  = String(req.query.ended  ?? '').toLowerCase() === 'true';
			// Construir filtro dinámico
			let filter: Record<string, unknown> = {};
			if (live)        filter = { active: true  };
			else if (ended)  filter = { active: false };
			// Buscar y ordenar (nuevo→antiguo)
			const streams = await this.streamModel
			.find(filter)
			.sort({ createdAt: -1 })          // opcional, pero útil UI
			.lean();                          // evita sobrecarga de Mongoose

			return res.status(StatusCodes.OK).json({ streams });
		} catch (error) {
			console.error('Error obteniendo streams:', error);
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al obtener los streams' });
		}
	}

	private async createStream(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { title, visibility, careerIds, description } = req.body;
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			// Validar los campos obligatorios
			if (!title || !visibility) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Título y visibilidad son requeridos' });
			}

			// Generar un streamKey único
			const streamKey = uuidv4();

			const newStreamData: Partial<IStream> = {
				title,
				userId,
				streamKey,
				visibility,
				active: true,
				description
			};

			// Manejar opciones según la visibilidad
			if (visibility === 'career' && careerIds && careerIds.length > 0) {
				newStreamData.careerIds = careerIds;
			} else if (visibility === 'private') {
				// Generar un código de acceso aleatorio
				newStreamData.accessCode = Math.random().toString(36).substring(2, 10);
			}

			const newStream = new this.streamModel(newStreamData);
			await newStream.save();
this.socketController.emitStreamCreated(newStream);
			// Definir la interfaz para response
			interface StreamResponse {
				stream: IStream;
				accessCode?: string;
			}

			// Crear el objeto response con el tipo definido
			const response: StreamResponse = { stream: newStream };

			// Si es privado, agregar el accessCode
			if (visibility === 'private') {
				response.accessCode = newStream.accessCode;
				console.log('Código de acceso enviado en la respuesta:', response.accessCode);
			}

			return res.status(StatusCodes.CREATED).json(response);
		} catch (error) {
			console.error('Error creando stream:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear el stream' });
		}
	}
	private async deleteStream(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { streamId } = req.params;
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}
			// Verificar que el usuario es el propietario del stream
			const stream = await this.streamModel.findOneAndUpdate(
				{ _id: streamId, userId },
				{ active: false },
				{ new: true }
			);
			if (!stream) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Stream no encontrado o no tienes permisos para eliminarlo' });
			}

			// Emitir un evento a través del SocketController para notificar a los espectadores
			this.socketController.emitToRoom(streamId, 'stream-ended', { message: 'El stream ha finalizado.' });

			return res.status(StatusCodes.OK).json({ message: 'Stream detenido', stream });
		} catch (error) {
			console.error('Error deteniendo el stream:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al detener el stream' });
		}
	}

	private async startScreenShare(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { streamId } = req.params;
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			// Verificar que el usuario es el propietario del stream
			const stream = await this.streamModel.findOne({ _id: streamId, userId });
			if (!stream) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Stream no encontrado o no tienes permisos para compartir pantalla' });
			}

			// Actualizar el estado de isScreenSharing
			stream.isScreenSharing = true;
			await stream.save();

			// Emitir un evento a través del SocketController
			this.socketController.emitToRoom(streamId, 'start-screen-share', { streamId });

			return res.status(StatusCodes.OK).json({ message: 'Compartición de pantalla iniciada' });
		} catch (error) {
			console.error('Error iniciando la compartición de pantalla:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al iniciar la compartición de pantalla' });
		}
	}

	private async stopScreenShare(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { streamId } = req.params;
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			// Verificar que el usuario es el propietario del stream
			const stream = await this.streamModel.findOne({ _id: streamId, userId });
			if (!stream) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Stream no encontrado o no tienes permisos para detener la compartición de pantalla' });
			}

			// Actualizar el estado de isScreenSharing
			stream.isScreenSharing = false;
			await stream.save();

			// Emitir un evento a través del SocketController
			this.socketController.emitToRoom(streamId, 'stop-screen-share', { streamId });

			return res.status(StatusCodes.OK).json({ message: 'Compartición de pantalla detenida' });
		} catch (error) {
			console.error('Error deteniendo la compartición de pantalla:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al detener la compartición de pantalla' });
		}
	}

	// Resto de los métodos existentes...
	private async joinStream(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { streamId } = req.params;
			const { accessCode } = req.body;

			const stream = await this.streamModel.findById(streamId);
			if (!stream || !stream.active) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Stream no disponible' });
			}

			if (stream.visibility === 'private' && stream.accessCode !== accessCode) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Código de acceso incorrecto' });
			}

			// Opcional: emitir evento de que alguien se unió
			this.socketController.emitToRoom(streamId, 'viewer-joined', { streamId });

			return res.status(StatusCodes.OK).json({ stream });
		} catch (error) {
			console.error('Error al unirse al stream:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al unirse al stream' });
		}
	}

	// Marcar stream como finalizado (endedAt)
	private async endStream(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { streamId } = req.params;
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			const stream = await this.streamModel.findOneAndUpdate(
				{ _id: streamId, userId },
				{ active: false, endedAt: new Date() },
				{ new: true }
			);

			if (!stream) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Stream no encontrado o no tienes permisos' });
			}

			this.socketController.emitStreamEnded(stream);
			return res.status(StatusCodes.OK).json({ message: 'Stream finalizado', stream });
		} catch (error) {
			console.error('Error finalizando stream:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al finalizar el stream' });
		}
	}

	// Like y Unlike (usa el mismo helper para evitar duplicar)
	private async likeStream(req: AuthRequest, res: Response): Promise<Response> {
		return this.toggleLike(req, res, true);
	}

	private async unlikeStream(req: AuthRequest, res: Response): Promise<Response> {
		return this.toggleLike(req, res, false);
	}

	private async toggleLike(req: AuthRequest, res: Response, like: boolean): Promise<Response> {
		try {
			const { streamId } = req.params;
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			const update = like
				? { $addToSet: { likes: userId } }
				: { $pull: { likes: userId } };

				const stream = await this.streamModel.findByIdAndUpdate(streamId, update, { new: true });

				if (!stream) {
					return res.status(StatusCodes.NOT_FOUND).json({ message: 'Stream no encontrado' });
				}

				this.socketController.emitToRoom(streamId, 'stream-like', { userId, like });
				return res.status(StatusCodes.OK).json({ likes: stream.likes?.length ?? 0 });
		} catch (error) {
			console.error('Error (un)like stream:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al procesar like/unlike' });
		}
	}

	// Incrementar contador de vistas (público, sin auth)
	private async incrementViewCount(req: Request, res: Response): Promise<Response> {
		try {
			const { streamId } = req.params;
			await this.streamModel.findByIdAndUpdate(streamId, { $inc: { viewerCount: 1 } });
			return res.sendStatus(StatusCodes.NO_CONTENT);
		} catch (error) {
			console.error('Error incrementando vistas:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al incrementar vistas' });
		}
	}

	private async listViewers(req: Request, res: Response) {
		const { streamId } = req.params;

		const viewersSet = this.socketController.getViewers(streamId);

		if (!viewersSet || viewersSet.size === 0) {
			return res.status(StatusCodes.OK).json({ viewers: [] });
		}

		const ids   = Array.from(viewersSet);
		const users = await this.userModel
		.find({ _id: { $in: ids } })
		.select('_id username')
		.exec();

		console.log('[REST] /viewers', streamId, '→', users.map(u => u.username));

		return res.status(StatusCodes.OK).json({ viewers: users });
	}

	private async kickViewer(req: AuthRequest, res: Response) {
		const { streamId } = req.params;
		const { viewerId } = req.body;
		const userId = req.userId;

		// 1) solo el dueño puede expulsar
		const stream = await this.streamModel.findOne({ _id: streamId, userId });
		if (!stream) {
			return res.status(StatusCodes.FORBIDDEN).json({ message: 'Sin permiso' });
		}

		/* 2) emitir al espectador expulsado  */
		this.socketController.emitToUser(viewerId, 'kicked', { streamId });

		/* 3) quitarlo del mapa */
		const set = this.socketController.getViewers(streamId);
		set?.delete(viewerId);

		/* 4) notificar lista actualizada al streamer */
		this.socketController.emitToRoom(streamId, 'update-viewers', {
			viewers: Array.from(set || []),
		});

		return res.sendStatus(StatusCodes.NO_CONTENT);
	}

}

export default StreamController;

