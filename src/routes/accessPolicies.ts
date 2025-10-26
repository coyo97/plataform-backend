// src/routes/accessPolicies.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import App from '../app';
import { authMiddleware, adminMiddleware } from '../middlware/authMiddlewares';
import { body, validationResult } from 'express-validator';
import { AccessPolicyModel } from './schemas/accessPolicy';
import { ModuleModel } from './schemas/module';
import { ActionModel } from './schemas/action';
import { dynamicPermissionMiddleware } from '../middlware/permissionMiddleware';

export class AccessPoliciesController {
	private route: string;
	private app: App;
	private policyModel: ReturnType<typeof AccessPolicyModel>;
	private moduleModel: ReturnType<typeof ModuleModel>;
	private actionModel: ReturnType<typeof ActionModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.policyModel = AccessPolicyModel(this.app.getClientMongoose());
		this.moduleModel = ModuleModel(this.app.getClientMongoose());
		this.actionModel = ActionModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes() {
		// Listar políticas
		this.app.getAppServer().get(
			`${this.route}/access-policies`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.list.bind(this)
		);

		// Crear política
		this.app.getAppServer().post(
			`${this.route}/access-policies`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[
				body('moduleId').notEmpty().withMessage('moduleId es requerido'),
				body('actionId').notEmpty().withMessage('actionId es requerido'),
				body('effect').isIn(['allow','deny']).withMessage('effect inválido'),
				body('subject').optional().isArray(),
				body('target').optional().isArray(),
				body('resource').optional().isArray(),
				body('enabled').optional().isBoolean(),
				body('label').optional().isString(),
			],
			this.create.bind(this)
		);

		// Actualizar política
		this.app.getAppServer().put(
			`${this.route}/access-policies/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[
				body('moduleId').optional().isString(),
				body('actionId').optional().isString(),
				body('effect').optional().isIn(['allow','deny']),
				body('subject').optional().isArray(),
				body('target').optional().isArray(),
				body('resource').optional().isArray(),
				body('enabled').optional().isBoolean(),
				body('label').optional().isString(),
			],
			this.update.bind(this)
		);

		// Eliminar política
		this.app.getAppServer().delete(
			`${this.route}/access-policies/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.remove.bind(this)
		);
	}

	private async list(req: Request, res: Response) {
		const items = await this.policyModel
		.find()
		.populate('module')
		.populate('action')
		.sort({ updatedAt: -1 })
		.exec();

		res.status(StatusCodes.OK).json({ policies: items });
	}

	private async create(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
		}

		const { moduleId, actionId, effect, subject, target, resource, label, enabled } = req.body;

		const [mod, act] = await Promise.all([
			this.moduleModel.findById(moduleId),
			this.actionModel.findById(actionId),
		]);
		if (!mod || !act) {
			return res.status(StatusCodes.NOT_FOUND).json({ message: 'Módulo o acción no encontrados' });
		}

		const doc = await this.policyModel.create({
			module: mod._id,
			action: act._id,
			effect,
			subject: Array.isArray(subject) ? subject : [],
			target:  Array.isArray(target)  ? target  : [],
			resource:Array.isArray(resource)? resource: [],
			label,
			enabled: typeof enabled === 'boolean' ? enabled : true,
		});

		res.status(StatusCodes.CREATED).json({ policy: doc });
	}

	private async update(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
		}

		const { id } = req.params;
		const patch: any = { ...req.body };

		// Si viene moduleId/actionId, convertirlos a refs reales
		if (patch.moduleId) {
			const mod = await this.moduleModel.findById(patch.moduleId);
			if (!mod) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Módulo no encontrado' });
			patch.module = mod._id; delete patch.moduleId;
		}
		if (patch.actionId) {
			const act = await this.actionModel.findById(patch.actionId);
			if (!act) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Acción no encontrada' });
			patch.action = act._id; delete patch.actionId;
		}

		// Normalizar arrays
		if (patch.subject && !Array.isArray(patch.subject))  patch.subject  = [];
		if (patch.target  && !Array.isArray(patch.target))   patch.target   = [];
		if (patch.resource&& !Array.isArray(patch.resource)) patch.resource = [];

		const doc = await this.policyModel.findByIdAndUpdate(id, patch, { new: true });
		if (!doc) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Política no encontrada' });

		res.status(StatusCodes.OK).json({ policy: doc });
	}

	private async remove(req: Request, res: Response) {
		const { id } = req.params;
		const doc = await this.policyModel.findByIdAndDelete(id);
		if (!doc) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Política no encontrada' });
		res.status(StatusCodes.OK).json({ message: 'Eliminada' });
	}
}

