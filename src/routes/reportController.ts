import { Request, Response } from "express"
import { StatusCodes } from "http-status-codes";
import { ReportModel } from "./schemas/report";
import App from "../app";
import { authMiddleware, adminMiddleware } from "../middlware/authMiddlewares";
import SocketController from "./socket";
import NotificationService from "./schemas/notificationService";

interface AuthRequest extends Request {
	userId?: string;
}

export class ReportController {
	private route: string;
	private app: App;
	private reportModel: ReturnType<typeof ReportModel>;
	private notificationService: NotificationService;

	constructor(app: App, route: string, socketController: SocketController) {
		this.route = route;
		this.app = app;
		this.reportModel = ReportModel(this.app.getClientMongoose());
		this.notificationService = new NotificationService(this.app.getClientMongoose(), socketController);
		this.initRoutes();
	}

	private initRoutes(): void {
		this.app.getAppServer().get(`${this.route}/reports`, authMiddleware, this.getReports.bind(this));

		this.app.getAppServer().put(`${this.route}/reports/:id`, authMiddleware, this.updateReportStatus.bind(this));

		this.app.getAppServer().post(
			`${this.route}/reports/:id/notifications`,
			authMiddleware,
			this.notifyFromReport.bind(this)
		);

		this.app.getAppServer().post(
			`${this.route}/reports/:id/notify`,
			authMiddleware,
			this.sendReportNotification.bind(this)
		);
	}

	private async getReports(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const reports = await this.reportModel
			.find()
			.populate("reporter", "username")
			.populate({
				path: "target",
				populate: { path: "author", select: "username" },
			})
			.exec();

			return res.status(StatusCodes.OK).json({ reports });
		} catch (error) {
			console.error("Error al obtener los reportes:", error);
			return res
			.status(StatusCodes.INTERNAL_SERVER_ERROR)
			.json({ message: "Error al obtener los reportes", error });
		}
	}

	private async updateReportStatus(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const { status } = req.body;

			if (!["pending", "reviewed", "dismissed"].includes(status)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Estado inválido" });
			}

			const report = await this.reportModel
			.findById(id)
			.populate("reporter", "username") // solo necesitamos el reportante aquí
			.exec();

			if (!report) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: "Reporte no encontrado" });
			}

			report.status = status;
			await report.save();

			// Notificar al reportante
			const reporterId = (report as any).reporter?._id?.toString?.();
			if (reporterId) {
				const message =
					status === "reviewed"
						? "Tu reporte está en revisión por el equipo de moderación."
						: status === "dismissed"
							? "Tu reporte fue descartado. Gracias por tu colaboración."
							: `El estado de tu reporte cambió a ${status}.`;

							await this.notificationService.sendMany({
								recipients: [reporterId],
								sender: req.userId,
								type: "report_alert",
								message,
								data: {
									reportId: String((report as any)._id),
									targetId: String((report as any).target),
									targetType: (report as any).targetType,
									reason: report.reason,
									newStatus: status,
								},
							});
			}

			return res.status(StatusCodes.OK).json({ message: "Reporte actualizado", report });
		} catch (error) {
			console.error("Error al actualizar el reporte:", error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error al actualizar el reporte", error });
		}
	}


	private async notifyFromReport(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const { audience, recipients = [], message, type = "report_alert" } = req.body || {};

			if (!message) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "Message is required" });
			}

			const report = await this.reportModel.findById(id).exec();
			if (!report) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: "Reporte no encontrado" });
			}

			// Resolver autor del target
			const { authorId } = await resolveTargetMeta(
				this.app.getClientMongoose(),
				(report as any).targetType,
				(report as any).target
			);

			// Necesitamos también el reportante si la audiencia lo incluye
			await report.populate("reporter", "username");

			const targets: string[] = [];
			const reporterId = (report as any).reporter?._id?.toString?.();

			if (audience === "author" && authorId) targets.push(authorId);
			if (audience === "reporter" && reporterId) targets.push(reporterId);
			if (audience === "both") {
				if (authorId) targets.push(authorId);
				if (reporterId) targets.push(reporterId);
			}
			if (audience === "custom" && Array.isArray(recipients)) {
				recipients.forEach((r) => targets.push(String(r)));
			}

			const uniqueTargets = Array.from(new Set(targets));
			if (!uniqueTargets.length) {
				// fallback: si no hay autor (p.ej. mensaje sin sender), al menos avisar al reportante
				if (reporterId) {
					const notifications = await this.notificationService.sendMany({
						recipients: [reporterId],
						sender: req.userId,
						type,
						message,
						data: {
							reportId: String((report as any)._id),
							targetId: String((report as any).target),
							targetType: (report as any).targetType,
							reason: report.reason,
							status: report.status,
							fallback: true,
						},
					});
					return res.status(StatusCodes.CREATED).json({ message: "Alertas enviadas (fallback a reportante)", notifications });
				}
				return res.status(StatusCodes.BAD_REQUEST).json({ message: "No hay destinatarios válidos para este reporte." });
			}

			const notifications = await this.notificationService.sendMany({
				recipients: uniqueTargets,
				sender: req.userId,
				type,
				message,
				data: {
					reportId: String((report as any)._id),
					targetId: String((report as any).target),
					targetType: (report as any).targetType,
					reason: report.reason,
					status: report.status,
				},
			});

			return res.status(StatusCodes.CREATED).json({ message: "Alertas enviadas", notifications });
		} catch (error) {
			console.error("Error al enviar notificaciones desde reporte:", error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error al enviar notificaciones desde reporte", error });
		}
	}


	private async sendReportNotification(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const { message } = req.body;

			const report = await this.reportModel.findById(id).exec();
			if (!report) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: "Reporte no encontrado" });
			}

			const { authorId } = await resolveTargetMeta(
				this.app.getClientMongoose(),
				(report as any).targetType,
				(report as any).target
			);

			if (!authorId) {
				// Fallback: si no hay autor, notifícale al reportante para no romper flujo
				await report.populate("reporter", "username");
				const reporterId = (report as any).reporter?._id?.toString?.();

				if (reporterId) {
					const [notification] = await this.notificationService.sendMany({
						recipients: [reporterId],
						sender: req.userId,
						type: "report_alert",
						message: message || "Se envió una alerta relacionada a tu reporte (no se pudo identificar autor del contenido).",
						data: {
							reportId: String((report as any)._id),
							targetId: String((report as any).target),
							targetType: (report as any).targetType,
							reason: report.reason,
							fallback: true,
						},
					});
					return res.status(StatusCodes.CREATED).json({ message: "Notificación enviada al reportante (fallback)", notification });
				}

				return res.status(StatusCodes.BAD_REQUEST).json({ message: "El contenido reportado no tiene autor y no se pudo notificar." });
			}

			const [notification] = await this.notificationService.sendMany({
				recipients: [authorId],
				sender: req.userId,
				type: "report_alert",
				message: message || "Has recibido una alerta por contenido reportado.",
				data: {
					reportId: String((report as any)._id),
					targetId: String((report as any).target),
					targetType: (report as any).targetType,
					reason: report.reason,
				},
			});

			return res.status(StatusCodes.CREATED).json({ message: "Notificación enviada", notification });
		} catch (error) {
			console.error("Error al enviar notificación desde reporte:", error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Error al enviar notificación", error });
		}
	}

}


// Helper: resuelve autor y metadatos del target según targetType
async function resolveTargetMeta(mongoose: any, targetType: string, targetId: any) {
	// Ajusta los nombres de modelo y campo de autor según tus esquemas reales
	const MAP: Record<string, { model: string; authorField: string }> = {
		publication: { model: "Publication", authorField: "author" },
		stream:      { model: "Stream",      authorField: "author" },   // o "owner"
		message:     { model: "Message",     authorField: "sender" },   // chat
		academicHelp:{ model: "AcademicHelp",authorField: "author" },   // ejemplo
	};

	const entry = MAP[targetType];
	if (!entry) return { authorId: null, authorField: null, model: null };

	const Model = mongoose.model(entry.model);
	// Trae solo el campo autor para no cargar de más
	const doc = await Model.findById(targetId).select(`${entry.authorField}`).lean().exec();

	const raw = doc?.[entry.authorField];
	// Puede venir como ObjectId o como subdoc { _id }
	const authorId =
		(typeof raw === "string" && raw) ||
		(raw?._id?.toString?.()) ||
		null;

	return { authorId, authorField: entry.authorField, model: entry.model };
}

