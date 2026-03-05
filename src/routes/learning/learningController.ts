import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import App from "../../app";
import { authMiddleware } from "../../middlware/authMiddlewares";

import { LearningSubjectModel } from "../schemas/learning/learningSubject";
import { LearningTopicModel } from "../schemas/learning/learningTopic";
import { LearningDocumentModel } from "../schemas/learning/learningDocument";
import { LearningChunkModel } from "../schemas/learning/learningChunk";

import { chunkText } from "../../learning/chunkingService";

import { embedText } from "../../learning/embeddingService";
import { ensureCollection, upsertPoint } from "../../learning/qdrantService";

import { chatWithOllama } from "../../learning/llmService";
import { ragAnswer } from "../../learning/ragService";

interface AuthRequest extends Request {
	userId?: string; // en tu sistema ya viene así
}

export class LearningController {
	private route: string;
	private app: App;

	private subjectModel: ReturnType<typeof LearningSubjectModel>;
	private topicModel: ReturnType<typeof LearningTopicModel>;
	private documentModel: ReturnType<typeof LearningDocumentModel>;
	private chunkModel: ReturnType<typeof LearningChunkModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;

		const m = this.app.getClientMongoose();
		this.subjectModel = LearningSubjectModel(m);
		this.topicModel = LearningTopicModel(m);
		this.documentModel = LearningDocumentModel(m);
		this.chunkModel = LearningChunkModel(m);

		this.initRoutes();
	}

	private initRoutes(): void {
		// Subjects
		this.app.getAppServer().post(`${this.route}/learning/subjects`, authMiddleware, this.createSubject.bind(this));
		this.app.getAppServer().get(`${this.route}/learning/subjects`, authMiddleware, this.listSubjects.bind(this));

		// Topics
		this.app.getAppServer().post(`${this.route}/learning/topics`, authMiddleware, this.createTopic.bind(this));
		this.app.getAppServer().get(`${this.route}/learning/topics`, authMiddleware, this.listTopics.bind(this));

		// Documents (por ahora solo notas de texto)
		this.app.getAppServer().post(`${this.route}/learning/documents`, authMiddleware, this.createDocument.bind(this));
		this.app.getAppServer().get(`${this.route}/learning/documents`, authMiddleware, this.listDocuments.bind(this));
		this.app.getAppServer().post(`${this.route}/learning/chat`, authMiddleware, this.chat.bind(this));

		// Indexación: document -> chunks
		this.app
		.getAppServer()
		.post(`${this.route}/learning/documents/:id/index`, authMiddleware, this.indexDocument.bind(this));
	}

	// ---------- SUBJECTS ----------
	private async createSubject(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { title, career, jurisdiction } = req.body;

			if (!title || typeof title !== "string" || !title.trim()) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "title es requerido" });
			}

			const subject = await this.subjectModel.create({
				user: userId,
				title: title.trim(),
				career: typeof career === "string" ? career.trim() : undefined,
				jurisdiction: typeof jurisdiction === "string" ? jurisdiction.trim() : "General",
				updated_at: new Date(),
			});

			return res.status(StatusCodes.CREATED).json({ subject });
		} catch (error: any) {
			return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message ?? "Error" });
		}
	}

	private async listSubjects(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const subjects = await this.subjectModel.find({ user: userId }).sort({ created_at: -1 }).exec();
			return res.status(StatusCodes.OK).json({ subjects });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}

	// ---------- TOPICS ----------
	private async createTopic(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, title } = req.body;

			if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}
			if (!title || typeof title !== "string" || !title.trim()) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "title es requerido" });
			}

			const topic = await this.topicModel.create({
				user: userId,
				subjectId,
				title: title.trim(),
				updated_at: new Date(),
			});

			return res.status(StatusCodes.CREATED).json({ topic });
		} catch (error: any) {
			return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message ?? "Error" });
		}
	}

	private async listTopics(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId } = req.query as any;
			const filter: any = { user: userId };
			if (subjectId && Types.ObjectId.isValid(subjectId)) filter.subjectId = subjectId;

			const topics = await this.topicModel.find(filter).sort({ created_at: -1 }).exec();
			return res.status(StatusCodes.OK).json({ topics });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}

	// ---------- DOCUMENTS ----------
	private async createDocument(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, topicId, title, content } = req.body;

			if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}
			if (topicId && !Types.ObjectId.isValid(topicId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}
			if (!title || typeof title !== "string" || !title.trim()) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "title es requerido" });
			}
			// MVP: solo notes (texto)
			if (!content || typeof content !== "string" || !content.trim()) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "content es requerido (por ahora solo notas)" });
			}

			const doc = await this.documentModel.create({
				user: userId,
				subjectId,
				topicId,
				title: title.trim(),
				sourceType: "note",
				content,
				status: "draft",
				updated_at: new Date(),
			});

			return res.status(StatusCodes.CREATED).json({ document: doc });
		} catch (error: any) {
			return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message ?? "Error" });
		}
	}

	private async listDocuments(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, topicId } = req.query as any;
			const filter: any = { user: userId };

			if (subjectId && Types.ObjectId.isValid(subjectId)) filter.subjectId = subjectId;
			if (topicId && Types.ObjectId.isValid(topicId)) filter.topicId = topicId;

			const documents = await this.documentModel.find(filter).sort({ created_at: -1 }).exec();
			return res.status(StatusCodes.OK).json({ documents });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}

	// ---------- INDEX (document -> chunks) ----------
	// ---------- INDEX (document -> chunks + embeddings + qdrant) ----------
	private async indexDocument(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "documentId inválido" });
			}

			const doc = await this.documentModel.findOne({ _id: id, user: userId }).exec();
			if (!doc) return res.status(StatusCodes.NOT_FOUND).json({ message: "Documento no encontrado" });

			if (!doc.content || !doc.content.trim()) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Documento no tiene content para indexar" });
			}

			// Re-index: borra chunks anteriores
			await this.chunkModel.deleteMany({ documentId: doc._id, user: userId }).exec();

			const chunks = chunkText(doc.content, 1200, 150);

			if (chunks.length === 0) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "No se pudieron generar chunks" });
			}

			// 1) Inserta chunks en Mongo
			await this.chunkModel.insertMany(
				chunks.map((c) => ({
					user: userId,
					documentId: doc._id,
					subjectId: doc.subjectId,
					topicId: doc.topicId,
					idx: c.idx,
					text: c.text,
					charStart: c.charStart,
					charEnd: c.charEnd,
					updated_at: new Date(),
				})),
				{ ordered: true }
			);

			// 2) Trae chunks guardados (para tener _id real y estable para Qdrant)
			const savedChunks = await this.chunkModel
			.find({ documentId: doc._id, user: userId })
			.sort({ idx: 1 })
			.exec();

			if (savedChunks.length === 0) {
				return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Chunks no encontrados después de insertar" });
			}

			// 3) Asegura colección en Qdrant (necesita tamaño del vector)
			const testVector = await embedText(savedChunks[0].text);
			await ensureCollection(testVector.length);

			// 4) Upsert a Qdrant (uno por chunk)
			for (const ch of savedChunks) {
				const v = await embedText(ch.text);

			// Qdrant acepta uint64 o UUID; usamos un entero seguro derivado del ObjectId
const qdrantPointId = Number.parseInt(String(ch._id).slice(-12), 16);

await upsertPoint(qdrantPointId, v, {
  chunkId: String(ch._id), // el _id real de Mongo
  userId: String(userId),
  subjectId: String(doc.subjectId),
  topicId: doc.topicId ? String(doc.topicId) : null,
  documentId: String(doc._id),
  chunkIdx: ch.idx,
});
			}

			doc.status = "indexed";
			doc.updated_at = new Date();
			await doc.save();

			return res.status(StatusCodes.OK).json({ ok: true, chunks: savedChunks.length });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async chat(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { question, topicId, limit } = req.body;

			if (!question || typeof question !== "string" || !question.trim()) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "question es requerido" });
			}
			if (topicId && !Types.ObjectId.isValid(topicId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}

			const prepared = await ragAnswer({
				userId,
				question: question.trim(),
				topicId,
				limit: typeof limit === "number" ? Math.max(1, Math.min(12, limit)) : 8,
				chunkModel: this.chunkModel as any,
				documentModel: this.documentModel as any,
			});

			// Si no hay citas (no encontró nada)
			if (!prepared.citations || prepared.citations.length === 0) {
				return res.status(StatusCodes.OK).json(prepared);
			}

			const system = [
				"Eres un tutor de estudio. Respondes en español.",
				"Usa SOLO la información del CONTEXTO. Si falta info, dilo.",
				"Cita tus afirmaciones usando los marcadores [1], [2], etc.",
				"No inventes citas. No uses fuentes externas.",
			].join("\n");

			const userPrompt = `PREGUNTA:\n${question.trim()}\n\nCONTEXTO:\n${prepared.context}\n\nINSTRUCCIÓN:\nResponde de forma clara y estructurada (si conviene, en viñetas).`;

			const answer = await chatWithOllama(system, userPrompt);

			return res.status(StatusCodes.OK).json({
				answer,
				citations: prepared.citations,
			});
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
}
