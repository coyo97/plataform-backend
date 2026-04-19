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
import { ensureCollection, upsertPoint, deletePointsByDocumentId } from "../../learning/qdrantService";

import { chatWithOllama } from "../../learning/llmService";
import { ragAnswer } from "../../learning/ragService";

import { LearningQuizItemModel } from "../schemas/learning/learningQuizItem";
import { generateQuizFromContext } from "../../learning/quizService";

import { LearningReviewModel } from "../schemas/learning/learningReview";
import { scheduleNextReview } from "../../learning/reviewSchedulerService";

import { SettingsModel } from "../schemas/settings";
import { getUploadMiddleware } from "../../middlware/upload";
import { extractTextFromFile } from "../../learning/fileTextExtractService";
import fs from "fs/promises";

import { extractAudioToWav } from "../../learning/audioExtractService";
import { transcribeAudio } from "../../learning/videoTranscriptionService";
import path from "path";

import { ocrImage } from "../../learning/imageOcrService";

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

	private quizItemModel: ReturnType<typeof LearningQuizItemModel>;

	private reviewModel: ReturnType<typeof LearningReviewModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;

		const m = this.app.getClientMongoose();
		this.subjectModel = LearningSubjectModel(m);
		this.topicModel = LearningTopicModel(m);
		this.documentModel = LearningDocumentModel(m);
		this.chunkModel = LearningChunkModel(m);
		this.quizItemModel = LearningQuizItemModel(m);
		this.reviewModel = LearningReviewModel(m);

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

		this.app.getAppServer().post(`${this.route}/learning/quizzes/generate`, authMiddleware, this.generateQuiz.bind(this));
		this.app.getAppServer().get(`${this.route}/learning/quizzes`, authMiddleware, this.listQuizzes.bind(this));

		this.app.getAppServer().get(`${this.route}/learning/review/today`, authMiddleware, this.getTodayReviews.bind(this));

		this.app.getAppServer().post(
			`${this.route}/learning/documents/upload-video`,
			authMiddleware,
			async (req, res, next) => {
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 200 * 1024 * 1024; // video suele ser más grande

				const upload = getUploadMiddleware(maxUploadSize);
				upload.single("file")(req, res, (err) => {
					if (err) return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					next();
				});
			},
			this.uploadVideoDocument.bind(this)
		);

		this.app.getAppServer().post(
			`${this.route}/learning/documents/upload`,
			authMiddleware,
			async (req, res, next) => {
				// igual que ProfileController: usa Settings para maxUploadSize
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 50 * 1024 * 1024;

				const upload = getUploadMiddleware(maxUploadSize);
				upload.single("file")(req, res, (err) => {
					if (err) return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					next();
				});
			},
			this.uploadDocument.bind(this)
		);
		this.app.getAppServer().post(
			`${this.route}/learning/documents/upload-audio`,
			authMiddleware,
			async (req, res, next) => {
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 100 * 1024 * 1024;

				const upload = getUploadMiddleware(maxUploadSize);
				upload.single("file")(req, res, (err) => {
					if (err) return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					next();
				});
			},
			this.uploadAudioDocument.bind(this)
		);
		this.app.getAppServer().post(`${this.route}/learning/review/:quizId/grade`, authMiddleware, this.gradeReview.bind(this));
		this.app.getAppServer().post(
			`${this.route}/learning/documents/upload-image-ocr`,
			authMiddleware,
			async (req, res, next) => {
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 20 * 1024 * 1024; // imágenes

				const upload = getUploadMiddleware(maxUploadSize);
				upload.single("file")(req, res, (err) => {
					if (err) return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					next();
				});
			},
			this.uploadImageOcrDocument.bind(this)
		);

		this.app
		.getAppServer()
		.post(`${this.route}/learning/documents/:id/index`, authMiddleware, this.indexDocument.bind(this));

		// Documents CRUD (ver/editar/eliminar)
		this.app.getAppServer().get(`${this.route}/learning/documents/:id`, authMiddleware, this.getDocumentById.bind(this));
		this.app.getAppServer().put(`${this.route}/learning/documents/:id`, authMiddleware, this.updateDocument.bind(this));
		this.app.getAppServer().delete(`${this.route}/learning/documents/:id`, authMiddleware, this.deleteDocument.bind(this));

		// Topics CRUD
		this.app.getAppServer().put(`${this.route}/learning/topics/:id`, authMiddleware, this.updateTopic.bind(this));
		this.app.getAppServer().delete(`${this.route}/learning/topics/:id`, authMiddleware, this.deleteTopic.bind(this));

		// Subjects CRUD
		this.app.getAppServer().put(`${this.route}/learning/subjects/:id`, authMiddleware, this.updateSubject.bind(this));
		this.app.getAppServer().delete(`${this.route}/learning/subjects/:id`, authMiddleware, this.deleteSubject.bind(this));
	}

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

			await this.chunkModel.deleteMany({ documentId: doc._id, user: userId }).exec();

			const chunks = chunkText(doc.content, 1200, 150);

			if (chunks.length === 0) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "No se pudieron generar chunks" });
			}

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

			const savedChunks = await this.chunkModel
			.find({ documentId: doc._id, user: userId })
			.sort({ idx: 1 })
			.exec();

			if (savedChunks.length === 0) {
				return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Chunks no encontrados después de insertar" });
			}

			const testVector = await embedText(savedChunks[0].text);
			await ensureCollection(testVector.length);

			for (const ch of savedChunks) {
				const v = await embedText(ch.text);

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
	private async generateQuiz(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { topicId, questionCount } = req.body;

			if (!topicId || !Types.ObjectId.isValid(topicId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}

			const count =
				typeof questionCount === "number"
					? Math.max(1, Math.min(10, questionCount))
					: 5;

					const topic = await this.topicModel.findOne({ _id: topicId, user: userId }).exec();
					if (!topic) {
						return res.status(StatusCodes.NOT_FOUND).json({ message: "Tema no encontrado" });
					}

					const prepared = await ragAnswer({
						userId,
						question: `Genera preguntas de estudio sobre ${topic.title}`,
						topicId,
						limit: 8,
						chunkModel: this.chunkModel as any,
						documentModel: this.documentModel as any,
					});

					if (!prepared.citations || prepared.citations.length === 0 || !prepared.context) {
						return res.status(StatusCodes.BAD_REQUEST).json({
							message: "No hay suficiente material indexado para generar quiz.",
						});
					}

					const quiz = await generateQuizFromContext({
						topicTitle: topic.title,
						count,
						context: prepared.context,
					});

					const sourceChunkIds = prepared.citations
					.map((c: any) => c.chunkId)
					.filter((id: string) => Types.ObjectId.isValid(id));

					const created = await this.quizItemModel.insertMany(
						quiz.items.map((item) => ({
							user: userId,
							subjectId: topic.subjectId,
							topicId: topic._id,
							question: item.question,
							type: item.type,
							options: Array.isArray(item.options) ? item.options : undefined,
							correctAnswer: item.correctAnswer,
							explanation: item.explanation,
							sourceChunkIds,
							updated_at: new Date(),
						})),
						{ ordered: true }
					);

					await this.reviewModel.insertMany(
						created.map((item: any) => ({
							user: userId,
							quizItemId: item._id,
							subjectId: item.subjectId,
							topicId: item.topicId,
							repetition: 0,
							intervalDays: 0,
							easeFactor: 2.5,
							dueDate: new Date(), // disponible para hoy
							updated_at: new Date(),
						})),
						{ ordered: true }
					);

					return res.status(StatusCodes.CREATED).json({ items: created });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}

	private async listQuizzes(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { topicId } = req.query as any;
			const filter: any = { user: userId };

			if (topicId) {
				if (!Types.ObjectId.isValid(topicId)) {
					return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
				}
				filter.topicId = topicId;
			}

			const items = await this.quizItemModel.find(filter).sort({ created_at: -1 }).exec();
			return res.status(StatusCodes.OK).json({ items });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}

	private async getTodayReviews(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { topicId } = req.query as any;
			const filter: any = {
				user: userId,
				dueDate: { $lte: new Date() },
			};

			if (topicId) {
				if (!Types.ObjectId.isValid(topicId)) {
					return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
				}
				filter.topicId = topicId;
			}

			const reviews = await this.reviewModel
			.find(filter)
			.sort({ dueDate: 1 })
			.populate({
				path: "quizItemId",
				select: "question type options correctAnswer explanation",
			})
			.exec();

			return res.status(StatusCodes.OK).json({ reviews });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}

	private async gradeReview(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { quizId } = req.params;
			const { grade } = req.body;

			if (!quizId || !Types.ObjectId.isValid(quizId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "quizId inválido" });
			}

			if (!["again", "hard", "good"].includes(grade)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "grade inválido" });
			}

			const quiz = await this.quizItemModel.findOne({ _id: quizId, user: userId }).exec();
			if (!quiz) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: "Quiz no encontrado" });
			}

			let review = await this.reviewModel.findOne({ quizItemId: quizId, user: userId }).exec();
			if (!review) {
				review = await this.reviewModel.create({
					user: userId,
					quizItemId: quiz._id,
					subjectId: quiz.subjectId,
					topicId: quiz.topicId,
					repetition: 0,
					intervalDays: 0,
					easeFactor: 2.5,
					dueDate: new Date(),
					updated_at: new Date(),
				});
			}

			const next = scheduleNextReview(
				{
					repetition: review.repetition,
					intervalDays: review.intervalDays,
					easeFactor: review.easeFactor,
				},
				grade
			);

			review.repetition = next.repetition;
			review.intervalDays = next.intervalDays;
			review.easeFactor = next.easeFactor;
			review.dueDate = next.dueDate;
			review.lastReviewedAt = new Date();
			review.updated_at = new Date();

			await review.save();

			return res.status(StatusCodes.OK).json({ review });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async uploadDocument(req: AuthRequest, res: Response): Promise<Response> {
		const deleteIfExists = async (p?: string) => {
			if (!p) return;
			try { await fs.unlink(p); } catch {}
		};

		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, topicId, title } = req.body;
			const file = (req as any).file as Express.Multer.File | undefined;

			if (!file) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Archivo requerido (file)" });

			if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}
			if (topicId && !Types.ObjectId.isValid(topicId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}

			const docTitle =
				typeof title === "string" && title.trim().length > 0 ? title.trim() : file.originalname;

			const extracted = await extractTextFromFile(file.path, file.mimetype);

			if (!extracted.text || extracted.text.length < 20) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({
					message: "No se pudo extraer texto del archivo (o está vacío).",
				});
			}

			const doc = await this.documentModel.create({
				user: userId,
				subjectId,
				topicId,
				title: docTitle,
				sourceType: extracted.detectedType === "unknown" ? "note" : extracted.detectedType, // o "pdf"/"docx"
				content: extracted.text,
				fileUrl: `uploads/${file.filename}`,
				originalName: file.originalname,
				status: "draft",
				updated_at: new Date(),
			});

			return res.status(StatusCodes.CREATED).json({ document: doc });
		} catch (error: any) {
			const file = (req as any).file as Express.Multer.File | undefined;
			if (file?.path) {
				try { await fs.unlink(file.path); } catch {}
			}
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async uploadVideoDocument(req: AuthRequest, res: Response): Promise<Response> {
		const deleteIfExists = async (p?: string) => {
			if (!p) return;
			try { await fs.unlink(p); } catch {}
		};

		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, topicId, title, language } = req.body;
			const file = (req as any).file as Express.Multer.File | undefined;

			if (!file) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Archivo requerido (file)" });

			if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}
			if (topicId && !Types.ObjectId.isValid(topicId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}

			if (!file.mimetype.startsWith("video/")) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "El archivo no es video/*" });
			}

			const docTitle =
				typeof title === "string" && title.trim().length > 0 ? title.trim() : file.originalname;

			const wavPath = await extractAudioToWav(file.path);

			const result = await transcribeAudio(wavPath, typeof language === "string" ? language : undefined);

			await deleteIfExists(wavPath);

			if (result?.error) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Error transcribiendo", error: result.error });
			}

			const text = (result?.text ?? "").trim();
			if (!text || text.length < 20) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Transcripción vacía o muy corta." });
			}

			const doc = await this.documentModel.create({
				user: userId,
				subjectId,
				topicId,
				title: docTitle,
				sourceType: "video",
				content: text,
				fileUrl: `uploads/${file.filename}`,
				originalName: file.originalname,
				status: "draft",
				updated_at: new Date(),
			});

			// OPCIONAL: auto-indexar aquí (si quieres)
			// Puedes llamar a this.indexDocument internamente, pero para MVP mejor manual:
			// POST /learning/documents/:id/index

			return res.status(StatusCodes.CREATED).json({
				document: doc,
				transcription: {
					language: result.language,
					duration: result.duration,
				},
			});
		} catch (error: any) {
			const file = (req as any).file as Express.Multer.File | undefined;
			if (file?.path) {
				try { await fs.unlink(file.path); } catch {}
			}
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async uploadAudioDocument(req: AuthRequest, res: Response): Promise<Response> {
		const deleteIfExists = async (p?: string) => {
			if (!p) return;
			try { await fs.unlink(p); } catch {}
		};

		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, topicId, title, language } = req.body;
			const file = (req as any).file as Express.Multer.File | undefined;

			if (!file) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Archivo requerido (file)" });

			if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}
			if (topicId && !Types.ObjectId.isValid(topicId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}

			if (!file.mimetype.startsWith("audio/")) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "El archivo no es audio/*" });
			}

			const docTitle =
				typeof title === "string" && title.trim().length > 0 ? title.trim() : file.originalname;

			const wavPath = await extractAudioToWav(file.path);

			const result = await transcribeAudio(wavPath, typeof language === "string" ? language : undefined);

			await deleteIfExists(wavPath);

			if (result?.error) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Error transcribiendo", error: result.error });
			}

			const text = (result?.text ?? "").trim();
			if (!text || text.length < 20) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Transcripción vacía o muy corta." });
			}

			const doc = await this.documentModel.create({
				user: userId,
				subjectId,
				topicId,
				title: docTitle,
				sourceType: "audio", // agrega "audio" al enum si quieres (o usa "video")
				content: text,
				fileUrl: `uploads/${file.filename}`,
				originalName: file.originalname,
				status: "draft",
				updated_at: new Date(),
			});

			return res.status(StatusCodes.CREATED).json({
				document: doc,
				transcription: { language: result.language, duration: result.duration },
			});
		} catch (error: any) {
			const file = (req as any).file as Express.Multer.File | undefined;
			if (file?.path) {
				try { await fs.unlink(file.path); } catch {}
			}
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async uploadImageOcrDocument(req: AuthRequest, res: Response): Promise<Response> {
		const deleteIfExists = async (p?: string) => {
			if (!p) return;
			try { await fs.unlink(p); } catch {}
		};

		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { subjectId, topicId, title } = req.body;
			const file = (req as any).file as Express.Multer.File | undefined;

			if (!file) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Archivo requerido (file)" });

			if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}
			if (topicId && !Types.ObjectId.isValid(topicId)) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			}

			if (!file.mimetype.startsWith("image/")) {
				await deleteIfExists(file.path);
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "El archivo no es image/*" });
			}

			const docTitle =
				typeof title === "string" && title.trim().length > 0 ? title.trim() : file.originalname;

			const text = (await ocrImage(file.path)).trim();

			if (!text || text.length < 15) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "OCR no detectó texto suficiente." });
			}

			const doc = await this.documentModel.create({
				user: userId,
				subjectId,
				topicId,
				title: docTitle,
				sourceType: "note", // o añade "image" si quieres en enum
				content: text,
				fileUrl: `uploads/${file.filename}`,
				originalName: file.originalname,
				status: "draft",
				updated_at: new Date(),
			});

			return res.status(StatusCodes.CREATED).json({ document: doc, ocrPreview: text.slice(0, 200) });
		} catch (error: any) {
			const file = (req as any).file as Express.Multer.File | undefined;
			if (file?.path) { try { await fs.unlink(file.path); } catch {} }
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async getDocumentById(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "documentId inválido" });
			}

			const doc = await this.documentModel.findOne({ _id: id, user: userId }).exec();
			if (!doc) return res.status(StatusCodes.NOT_FOUND).json({ message: "Documento no encontrado" });

			return res.status(StatusCodes.OK).json({ document: doc });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async updateDocument(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "documentId inválido" });
			}

			const { title, content } = req.body;

			const doc = await this.documentModel.findOne({ _id: id, user: userId }).exec();
			if (!doc) return res.status(StatusCodes.NOT_FOUND).json({ message: "Documento no encontrado" });

			// Validaciones mínimas
			if (title !== undefined && (typeof title !== "string" || !title.trim())) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "title inválido" });
			}
			if (content !== undefined && (typeof content !== "string" || !content.trim())) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "content inválido" });
			}

			// Aplicar cambios
			if (typeof title === "string") doc.title = title.trim();
			if (typeof content === "string") doc.content = content;

			// IMPORTANTE: invalidar index anterior
			doc.status = "draft";
			doc.updated_at = new Date();
			await doc.save();

			// limpiar chunks + qdrant de este documento
			await this.chunkModel.deleteMany({ documentId: doc._id, user: userId }).exec();
			await deletePointsByDocumentId(String(userId), String(doc._id));

			return res.status(StatusCodes.OK).json({
				document: doc,
				message: "Documento actualizado. Reindexa para actualizar el chat.",
			});
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async deleteDocument(req: AuthRequest, res: Response): Promise<Response> {
		const deleteIfExists = async (p?: string) => {
			if (!p) return;
			try { await fs.unlink(p); } catch {}
		};

		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "documentId inválido" });
			}

			const doc = await this.documentModel.findOne({ _id: id, user: userId }).exec();
			if (!doc) return res.status(StatusCodes.NOT_FOUND).json({ message: "Documento no encontrado" });

			// 1) borrar chunks
			await this.chunkModel.deleteMany({ documentId: doc._id, user: userId }).exec();

			// 2) borrar vectores qdrant
			await deletePointsByDocumentId(String(userId), String(doc._id));

			// 3) borrar archivo físico si hay fileUrl
			if ((doc as any).fileUrl) {
				// tu server sirve /uploads desde ../uploads, así que fileUrl suele ser "uploads/xxx"
				const rel = String((doc as any).fileUrl);
				const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
				await deleteIfExists(abs);
			}

			// 4) borrar documento
			await this.documentModel.deleteOne({ _id: doc._id }).exec();

			return res.status(StatusCodes.OK).json({ ok: true });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async updateTopic(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			const { title } = req.body;

			if (!id || !Types.ObjectId.isValid(id)) return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });
			if (!title || typeof title !== "string" || !title.trim()) return res.status(StatusCodes.BAD_REQUEST).json({ message: "title inválido" });

			const topic = await this.topicModel.findOne({ _id: id, user: userId }).exec();
			if (!topic) return res.status(StatusCodes.NOT_FOUND).json({ message: "Tema no encontrado" });

			topic.title = title.trim();
			topic.updated_at = new Date();
			await topic.save();

			return res.status(StatusCodes.OK).json({ topic });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async deleteTopic(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) return res.status(StatusCodes.BAD_REQUEST).json({ message: "topicId inválido" });

			const topic = await this.topicModel.findOne({ _id: id, user: userId }).exec();
			if (!topic) return res.status(StatusCodes.NOT_FOUND).json({ message: "Tema no encontrado" });

			const docsCount = await this.documentModel.countDocuments({ user: userId, topicId: topic._id }).exec();
			if (docsCount > 0) {
				return res.status(StatusCodes.CONFLICT).json({
					message: "No se puede eliminar el tema porque tiene documentos. Elimina primero los documentos.",
					docsCount,
				});
			}

			await this.topicModel.deleteOne({ _id: topic._id }).exec();
			return res.status(StatusCodes.OK).json({ ok: true });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async updateSubject(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}

			const { title, career, jurisdiction } = req.body;

			if (title !== undefined && (typeof title !== "string" || !title.trim())) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "title inválido" });
			}
			if (career !== undefined && typeof career !== "string") {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "career inválido" });
			}
			if (jurisdiction !== undefined && (typeof jurisdiction !== "string" || !jurisdiction.trim())) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "jurisdiction inválido" });
			}

			const subject = await this.subjectModel.findOne({ _id: id, user: userId }).exec();
			if (!subject) return res.status(StatusCodes.NOT_FOUND).json({ message: "Materia no encontrada" });

			if (typeof title === "string") subject.title = title.trim();
			if (typeof career === "string") subject.career = career.trim();
			if (typeof jurisdiction === "string") subject.jurisdiction = jurisdiction.trim();

			subject.updated_at = new Date();
			await subject.save();

			return res.status(StatusCodes.OK).json({ subject });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
	private async deleteSubject(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Usuario no autenticado" });

			const { id } = req.params;
			if (!id || !Types.ObjectId.isValid(id)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "subjectId inválido" });
			}

			const cascade = String((req.query as any)?.cascade ?? "false").toLowerCase() === "true";

			const subject = await this.subjectModel.findOne({ _id: id, user: userId }).exec();
			if (!subject) return res.status(StatusCodes.NOT_FOUND).json({ message: "Materia no encontrada" });

			// 1) contar dependencias
			const [topicsCount, docsCount] = await Promise.all([
				this.topicModel.countDocuments({ user: userId, subjectId: subject._id }).exec(),
				this.documentModel.countDocuments({ user: userId, subjectId: subject._id }).exec(),
			]);

			if (!cascade && (topicsCount > 0 || docsCount > 0)) {
				return res.status(StatusCodes.CONFLICT).json({
					message: "No se puede eliminar la materia porque tiene temas o documentos. Usa ?cascade=true para eliminar todo.",
					topicsCount,
					docsCount,
				});
			}

			if (cascade) {
				// 2) borrar documentos del subject (y su index)
				const docs = await this.documentModel
				.find({ user: userId, subjectId: subject._id })
				.select("_id")
				.exec();

				for (const d of docs) {
					const docId = String(d._id);

					// chunks mongo
					await this.chunkModel.deleteMany({ user: userId, documentId: d._id }).exec();

					// qdrant
					await deletePointsByDocumentId(String(userId), docId);

					// documento
					await this.documentModel.deleteOne({ _id: d._id, user: userId }).exec();
				}

				// 3) borrar topics del subject
				await this.topicModel.deleteMany({ user: userId, subjectId: subject._id }).exec();
			}

			// 4) borrar subject
			await this.subjectModel.deleteOne({ _id: subject._id, user: userId }).exec();

			return res.status(StatusCodes.OK).json({ ok: true });
		} catch (error: any) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error", error: error.message });
		}
	}
}

