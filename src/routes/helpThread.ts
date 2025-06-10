import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';

import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { HelpThreadModel } from './schemas/helpThread';
import SocketController from './socket';

interface AuthRequest extends Request {
	userId?: string;
}

export class HelpThreadController {
	private route: string;
	private app: App;
	private socket: SocketController;
	private threadModel: ReturnType<typeof HelpThreadModel>;

	constructor(app: App, route: string, socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.socket = socketController;
		this.threadModel = HelpThreadModel(this.app.getClientMongoose());
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
			authMiddleware,
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

	/** Publicar nuevo mensaje */
	private async postMessage(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;            // helpId
			const { content } = req.body;
			const userId = req.userId;

			if (!userId) {
				return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'No autenticado' });
			}

			let thread = await this.threadModel.findOne({ helpId: id });

			/* — nuevo sub-documento mensaje — */
			const message = {
				_id:      new Types.ObjectId(),
				author:   new Types.ObjectId(userId),
				content,
				created_at: new Date(),
				votes:    0
			};

			if (!thread) {
				thread = new this.threadModel({
					helpId: id,
					messages: [message]
				});
			} else {
				(thread.messages as any).push(message); // cast simple para TS
			}

			await thread.save();

			/* Socket: notificar a la sala del helpId */
			this.socket.emitToRoom(id, 'new-help-message', message);

			return res.status(StatusCodes.CREATED).json({ message });
		} catch (e) {
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al publicar mensaje', error: e });
		}
	}

	/** Marcar mensaje como solución */
	private async markAsSolved(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { threadId, msgId } = req.params;
			const thread = await this.threadModel.findById(threadId);

			if (!thread) {
				return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Hilo no encontrado' });
			}

			thread.solvedMessage = new Types.ObjectId(msgId);
			await thread.save();

			return res.status(StatusCodes.OK).json({ message: 'Marcado como solución' });
		} catch (e) {
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al marcar solución', error: e });
		}
	}

	/** Votar mensaje (+1) */
	private async voteMessage(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { threadId, msgId } = req.params;
			const thread = await this.threadModel.findById(threadId);

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

			message.votes += 1;
			await thread.save();

			return res.status(StatusCodes.OK).json({ message: 'Voto registrado' });
		} catch (e) {
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: 'Error al votar', error: e });
		}
	}
}

