// src/routes/permissionsController.ts
import { Request, Response } from 'express';
import { ModuleModel } from './schemas/module';
import { ActionModel } from './schemas/action';
import { PermissionModel } from './schemas/permission';
import App from '../app';
import { authMiddleware, adminMiddleware } from '../middlware/authMiddlewares';
import { body, validationResult } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import {dynamicPermissionMiddleware} from '../middlware/permissionMiddleware';

export class PermissionsController {
	private route: string;
	private moduleModel: ReturnType<typeof ModuleModel>;
	private actionModel: ReturnType<typeof ActionModel>;
	private permissionModel: ReturnType<typeof PermissionModel>;
	private app: App;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.moduleModel = ModuleModel(this.app.getClientMongoose());
		this.actionModel = ActionModel(this.app.getClientMongoose());
		this.permissionModel = PermissionModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {
		// Rutas para permisos
		this.app.getAppServer().get(
			`${this.route}/permissions`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.getPermissions.bind(this)
		);

		this.app.getAppServer().post(
			`${this.route}/permissions`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[
				body('moduleId').notEmpty().withMessage('El ID del módulo es obligatorio'),
				body('actionId').notEmpty().withMessage('El ID de la acción es obligatorio'),
				body('name').notEmpty().withMessage('El nombre es obligatorio'),
				body('description').optional().isString(),
			],
			this.createPermission.bind(this)
		);

		this.app.getAppServer().put(
			`${this.route}/permissions/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[
				body('moduleId').notEmpty().withMessage('El ID del módulo es obligatorio'),
				body('actionId').notEmpty().withMessage('El ID de la acción es obligatorio'),
				body('name').notEmpty().withMessage('El nombre es obligatorio'),
				body('description').optional().isString(),
			],
			this.updatePermission.bind(this)
		);

		this.app.getAppServer().delete(
			`${this.route}/permissions/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.deletePermission.bind(this)
		);

		// Rutas para módulos
		this.app.getAppServer().post(
			`${this.route}/modules`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[body('name').notEmpty().withMessage('El nombre es obligatorio')],
			this.createModule.bind(this)
		);

		this.app.getAppServer().put(
			`${this.route}/modules/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[body('name').notEmpty().withMessage('El nombre es obligatorio')],
			this.updateModule.bind(this)
		);

		this.app.getAppServer().delete(
			`${this.route}/modules/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.deleteModule.bind(this)
		);

		// Rutas para acciones
		this.app.getAppServer().post(
			`${this.route}/actions`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[body('name').notEmpty().withMessage('El nombre es obligatorio')],
			this.createAction.bind(this)
		);

		this.app.getAppServer().put(
			`${this.route}/actions/:id`, 
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[body('name').notEmpty().withMessage('El nombre es obligatorio')],
			this.updateAction.bind(this)
		);

		this.app.getAppServer().delete(
			`${this.route}/actions/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.deleteAction.bind(this)
		);

		// Rutas para módulos
		this.app.getAppServer().get(
			`${this.route}/modules`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.getModules.bind(this)
		);

		// Rutas para acciones
		this.app.getAppServer().get(
			`${this.route}/actions`,
			authMiddleware,  adminMiddleware, dynamicPermissionMiddleware,
			this.getActions.bind(this)
		);

	}

	// Métodos para permisos

	private async getPermissions(req: Request, res: Response): Promise<void> {
		try {
			const permissions = await this.permissionModel
			.find()
			.populate('module')
			.populate('action')
			.exec();
			res.status(StatusCodes.OK).json({ permissions });
		} catch (error) {
			console.error('Error al obtener permisos:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener permisos' });
		}
	}

	private async createPermission(req: Request, res: Response): Promise<Response> {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
		}

		try {
			const { moduleId, actionId, name, description } = req.body;

			// Verificar existencia de módulo y acción
			const module = await this.moduleModel.findById(moduleId);
			const action = await this.actionModel.findById(actionId);

			if (!module || !action) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Módulo o acción no encontrados' });
			}

			// Verificar si el permiso ya existe
			let permission = await this.permissionModel.findOne({ module: moduleId, action: actionId });

			if (permission) {
				// El permiso ya existe, devolverlo
				return res.status(StatusCodes.OK).json({ permission });
			}

			// Crear nuevo permiso si no existe
			permission = new this.permissionModel({
				module: module._id,
				action: action._id,
				name,
				description,
			});

			await permission.save();
			return res.status(StatusCodes.CREATED).json({ permission });
		} catch (error) {
			console.error('Error al crear permiso:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear permiso' });
		}
	}

	private async updatePermission(req: Request, res: Response): Promise<void> {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
			return;
		}

		try {
			const { id } = req.params;
			const { moduleId, actionId, name, description } = req.body;

			// Verificar existencia de módulo y acción
			const module = await this.moduleModel.findById(moduleId);
			const action = await this.actionModel.findById(actionId);

			if (!module || !action) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Módulo o acción no encontrados' });
				return;
			}

			const permission = await this.permissionModel.findByIdAndUpdate(
				id,
				{ module: module._id, action: action._id, name, description },
				{ new: true }
			);

			if (!permission) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Permiso no encontrado' });
				return;
			}

			res.status(StatusCodes.OK).json({ permission });
		} catch (error) {
			console.error('Error al actualizar permiso:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar permiso' });
		}
	}

	private async deletePermission(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const permission = await this.permissionModel.findByIdAndDelete(id);
			if (!permission) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Permiso no encontrado' });
				return;
			}
			res.status(StatusCodes.OK).json({ message: 'Permiso eliminado' });
		} catch (error) {
			console.error('Error al eliminar permiso:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar permiso' });
		}
	}

	// Métodos para módulos

	private async createModule(req: Request, res: Response): Promise<void> {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
			return;
		}

		try {
			const { name } = req.body;
			const module = new this.moduleModel({ name });
			await module.save();
			res.status(StatusCodes.CREATED).json({ module });
		} catch (error) {
			console.error('Error al crear módulo:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear módulo' });
		}
	}

	private async updateModule(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const { name } = req.body;
			const module = await this.moduleModel.findByIdAndUpdate(id, { name }, { new: true });
			if (!module) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Módulo no encontrado' });
				return;
			}
			res.status(StatusCodes.OK).json({ module });
		} catch (error) {
			console.error('Error al actualizar módulo:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar módulo' });
		}
	}

	private async deleteModule(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const module = await this.moduleModel.findByIdAndDelete(id);
			if (!module) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Módulo no encontrado' });
				return;
			}
			res.status(StatusCodes.OK).json({ message: 'Módulo eliminado' });
		} catch (error) {
			console.error('Error al eliminar módulo:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar módulo' });
		}
	}

	// Métodos para acciones

	private async createAction(req: Request, res: Response): Promise<void> {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
			return;
		}

		try {
			const { name } = req.body;
			const action = new this.actionModel({ name });
			await action.save();
			res.status(StatusCodes.CREATED).json({ action });
		} catch (error) {
			console.error('Error al crear acción:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear acción' });
		}
	}

	private async updateAction(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const { name } = req.body;
			const action = await this.actionModel.findByIdAndUpdate(id, { name }, { new: true });
			if (!action) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Acción no encontrada' });
				return;
			}
			res.status(StatusCodes.OK).json({ action });
		} catch (error) {
			console.error('Error al actualizar acción:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar acción' });
		}
	}

	private async deleteAction(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const action = await this.actionModel.findByIdAndDelete(id);
			if (!action) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Acción no encontrada' });
				return;
			}
			res.status(StatusCodes.OK).json({ message: 'Acción eliminada' });
		} catch (error) {
			console.error('Error al eliminar acción:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar acción' });
		}
	}
	// Método para obtener módulos
	private async getModules(req: Request, res: Response): Promise<void> {
		try {
			const modules = await this.moduleModel.find().exec();
			res.status(StatusCodes.OK).json({ modules });
		} catch (error) {
			console.error('Error al obtener módulos:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener módulos' });
		}
	}

	// Método para obtener acciones
	private async getActions(req: Request, res: Response): Promise<void> {
		try {
			const actions = await this.actionModel.find().exec();
			res.status(StatusCodes.OK).json({ actions });
		} catch (error) {
			console.error('Error al obtener acciones:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener acciones' });
		}
	}

}

