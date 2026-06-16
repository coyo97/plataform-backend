// src/routes/roles.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { RoleModel } from './schemas/role';
import { PermissionModel } from './schemas/permission';
import App from '../app';
import { authMiddleware, adminMiddleware } from '../middlware/authMiddlewares';
import { body, validationResult } from 'express-validator';
import {dynamicPermissionMiddleware} from '../middlware/permissionMiddleware';

export class RoleController {
	private route: string;
	private app: App;
	private roleModel: ReturnType<typeof RoleModel>;
	private permissionModel: ReturnType<typeof PermissionModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.roleModel = RoleModel(this.app.getClientMongoose());
		this.permissionModel = PermissionModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {
		// Ruta para listar roles
		this.app.getAppServer().get(
			`${this.route}/roles`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.listRoles.bind(this)
		);

		// Ruta para crear un nuevo rol
		this.app.getAppServer().post(
			`${this.route}/roles`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[
				body('name').notEmpty().withMessage('El nombre es obligatorio'),
				body('description').optional().isString(),
				body('permissions.*').isMongoId().withMessage('Cada permiso debe ser un ID válido'),
			],
			this.createRole.bind(this)
		);

		// Ruta para editar un rol existente
		this.app.getAppServer().put(
			`${this.route}/roles/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			[
				body('name').notEmpty().withMessage('El nombre es obligatorio'),
				body('description').optional().isString(),
				body('permissions').isArray().withMessage('Los permisos deben ser un array de IDs'),
				body('permissions.*').isMongoId().withMessage('Cada permiso debe ser un ID válido'),
			],
			this.editRole.bind(this)
		);

		// Ruta para eliminar un rol
		this.app.getAppServer().delete(
			`${this.route}/roles/:id`,
			authMiddleware, adminMiddleware, dynamicPermissionMiddleware,
			this.deleteRole.bind(this)
		);
		this.app.getAppServer().get(
			`${this.route}/roles/:id`,
			authMiddleware,
			adminMiddleware, dynamicPermissionMiddleware,
			this.getRoleById.bind(this)
		);
	}

	private async listRoles(req: Request, res: Response): Promise<Response> {
		try {
			const roles = await this.roleModel.find()
			.populate({
				path: 'permissions',
				populate: [{ path: 'module' }, { path: 'action' }],
			})
			.exec();
			return res.status(StatusCodes.OK).json({ roles });
		} catch (error) {
			console.error('Error al listar los roles:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al listar los roles', error });
		}
	}

	private async createRole(req: Request, res: Response): Promise<Response> {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
		}

		const { name, description, permissions } = req.body;

		try {
			// Verificar que los permisos existen
			const existingPermissions = await this.permissionModel.find({ _id: { $in: permissions } }).exec();

			if (existingPermissions.length !== permissions.length) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Algunos permisos no existen' });
			}

			const newRole = new this.roleModel({ name, description, permissions });
			const result = await newRole.save();
			return res.status(StatusCodes.CREATED).json({ role: result });
		} catch (error) {
			console.error('Error al crear el rol:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear el rol', error });
		}
	}

	private async editRole(req: Request, res: Response): Promise<Response> {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
		}

		const { id } = req.params;
		const { name, description, permissions } = req.body;

		try {
			// Verificar que los permisos existen
			const existingPermissions = await this.permissionModel.find({ _id: { $in: permissions } }).exec();

			if (existingPermissions.length !== permissions.length) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Algunos permisos no existen' });
			}

			const role = await this.roleModel.findByIdAndUpdate(
				id,
				{ name, description, permissions },
				{ new: true }
			).exec();

			if (!role) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Rol no encontrado' });
			}
			return res.status(StatusCodes.OK).json({ role });
		} catch (error) {
			console.error('Error al editar el rol:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al editar el rol', error });
		}
	}

	private async deleteRole(req: Request, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const role = await this.roleModel.findByIdAndDelete(id).exec();
			if (!role) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Rol no encontrado' });
			}
			return res.status(StatusCodes.OK).json({ message: 'Rol eliminado correctamente' });
		} catch (error) {
			console.error('Error al eliminar el rol:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar el rol', error });
		}
	}
	private async getRoleById(req: Request, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const role = await this.roleModel.findById(id)
			.populate({
				path: 'permissions',
				populate: [{ path: 'module' }, { path: 'action' }],
			})
			.exec();

			if (!role) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Rol no encontrado' });
			}

			return res.status(StatusCodes.OK).json({ role });
		} catch (error) {
			console.error('Error al obtener el rol:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener el rol', error });
		}
	}
}

