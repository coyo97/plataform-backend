// src/routes/groupController.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import mongoose, { Types } from 'mongoose'; // Importa mongoose para usar ObjectId
import { GroupModel, IGroup } from './schemas/group';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

interface AuthRequest extends Request {
	userId?: string;
}

export class GroupController {
	private route: string;
	private app: App;
	private groupModel: ReturnType<typeof GroupModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.groupModel = GroupModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	// Inicializa las rutas HTTP
	private initRoutes(): void {
		this.app.getAppServer().post( `${this.route}/groups/create`, authMiddleware, this.createGroup.bind(this));

		this.app.getAppServer().get( `${this.route}/groups`, authMiddleware, this.getGroups.bind(this));
		this.app.getAppServer().post( `${this.route}/groups/:groupId/leave`, authMiddleware, this.leaveGroup.bind(this));

// Ruta para eliminar un grupo
this.app.getAppServer().delete( `${this.route}/groups/:groupId`, authMiddleware, this.deleteGroup.bind(this));
// Otorgar permisos de admin a un usuario (solo creador)
this.app.getAppServer().post( `${this.route}/groups/:groupId/admins/grant`, authMiddleware, this.grantGroupAdmin.bind(this));

// Revocar permisos de admin a un usuario (solo creador)
this.app.getAppServer().post( `${this.route}/groups/:groupId/admins/revoke`, authMiddleware, this.revokeGroupAdmin.bind(this));

		this.app.getAppServer().post( `${this.route}/groups/:groupId/join`, authMiddleware, this.joinGroup.bind(this));

		// Ruta para agregar un usuario al grupo
		this.app.getAppServer().post( `${this.route}/groups/:groupId/addUser`, authMiddleware, this.addUserToGroup.bind(this));
		// Ruta para obtener los miembros de un grupo
		this.app.getAppServer().get( `${this.route}/groups/:groupId/members`, authMiddleware, this.getGroupMembers.bind(this));
		// Ruta para eliminar un usuario del grupo
		this.app.getAppServer().post( `${this.route}/groups/:groupId/removeUser`, authMiddleware, this.removeUserFromGroup.bind(this));

		// Ruta para obtener los grupos creados por el usuario
		this.app.getAppServer().get( `${this.route}/groups/mygroups`, authMiddleware, this.getMyGroups.bind(this));

	}

	// Método para crear un grupo
	private async createGroup(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { name, description } = req.body;
			const createdBy = req.userId;

			const newGroup = new this.groupModel({
				name,
				description,
				members: [new mongoose.Types.ObjectId(createdBy)],
				createdBy: new mongoose.Types.ObjectId(createdBy),
				admins: [new mongoose.Types.ObjectId(createdBy)], // Agrega al creador como admin
			});

			const savedGroup = await newGroup.save();
			return res.status(StatusCodes.CREATED).json({ group: savedGroup });
		} catch (error) {
			console.error('Error al crear el grupo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear el grupo', error });
		}
	}

	// Método para obtener los grupos del usuario
	private async getGroups(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;

			const groups = await this.groupModel.find({ members: new mongoose.Types.ObjectId(userId) }) // Convertir userId a ObjectId
			.populate('members', 'username')
			.exec();
			return res.status(StatusCodes.OK).json({ groups });
		} catch (error) {
			console.error('Error al obtener los grupos:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener los grupos', error });
		}
	}

	// Método para unirse a un grupo
	private async joinGroup(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = new mongoose.Types.ObjectId(req.userId); // Convertir userId a ObjectId
			const { groupId } = req.params;

			const group = await this.groupModel.findById(groupId);
			if (!group) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });
			}

			if (!group.members.includes(userId)) {
				group.members.push(userId);
				await group.save();
			}

			return res.status(StatusCodes.OK).json({ group });
		} catch (error) {
			console.error('Error al unirse al grupo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al unirse al grupo', error });
		}
	}
	// Método para agregar un usuario al grupo
	private async addUserToGroup(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}
			const { groupId } = req.params;
			const { userToAddId } = req.body; // ID del usuario a agregar

			if (!userToAddId) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'User ID to add is required' });
			}

			const group = await this.groupModel.findById(groupId);
			if (!group) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });
			}

			// Verificar si el usuario que realiza la solicitud es el creador o un administrador
			if (
				group.createdBy.toString() !== userId &&
				!group.admins.map((id) => id.toString()).includes(userId)
			) {
				return res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para agregar usuarios a este grupo' });
			}

			const userToAddObjectId = new mongoose.Types.ObjectId(userToAddId);

			// Verificar si el usuario ya es miembro del grupo
			if (group.members.includes(userToAddObjectId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El usuario ya es miembro del grupo' });
			}

			group.members.push(userToAddObjectId);
			await group.save();

			return res.status(StatusCodes.OK).json({ group });
		} catch (error) {
			console.error('Error al agregar usuario al grupo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al agregar usuario al grupo', error });
		}
	}

	// Método para eliminar un usuario del grupo
	private async removeUserFromGroup(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}
			const { groupId } = req.params;
			const { userToRemoveId } = req.body; // ID del usuario a eliminar

			if (!userToRemoveId) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'User ID to remove is required' });
			}

			const group = await this.groupModel.findById(groupId);
			if (!group) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });
			}

			// Verificar si el usuario que realiza la solicitud es el creador o un administrador
			if (
				group.createdBy.toString() !== userId &&
				!group.admins.map((id) => id.toString()).includes(userId)
			) {
				return res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para eliminar usuarios de este grupo' });
			}

			const userToRemoveObjectId = new mongoose.Types.ObjectId(userToRemoveId);

			// Verificar si el usuario es miembro del grupo
			if (!group.members.includes(userToRemoveObjectId)) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El usuario no es miembro del grupo' });
			}

			// No permitir que el creador sea eliminado
			if (group.createdBy.toString() === userToRemoveId) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'No puedes eliminar al creador del grupo' });
			}

			// Eliminar al usuario de la lista de miembros
			group.members = group.members.filter((memberId) => !memberId.equals(userToRemoveObjectId));

			// Si el usuario es un administrador, también eliminarlo de la lista de admins
			group.admins = group.admins.filter((adminId) => !adminId.equals(userToRemoveObjectId));

			await group.save();

			return res.status(StatusCodes.OK).json({ group });
		} catch (error) {
			console.error('Error al eliminar usuario del grupo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar usuario del grupo', error });
		}
	}
	// Método para obtener los grupos creados por el usuario
	private async getMyGroups(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			const groups = await this.groupModel.find({ createdBy: new mongoose.Types.ObjectId(userId) })
			.populate('members', 'username')
			.exec();
			return res.status(StatusCodes.OK).json({ groups });
		} catch (error) {
			console.error('Error al obtener los grupos creados por el usuario:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener los grupos creados por el usuario', error });
		}
	}
	// Método para obtener los miembros de un grupo
	private async getGroupMembers(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			const { groupId } = req.params;

			const group = await this.groupModel.findById(groupId)
			.populate('members', 'username email')
			.exec();

			if (!group) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });
			}

			// Verificar si el usuario es miembro del grupo
			if (!group.members.some(member => member._id.toString() === userId)) {
				return res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para ver los miembros de este grupo' });
			}

			return res.status(StatusCodes.OK).json({ members: group.members });
		} catch (error) {
			console.error('Error al obtener los miembros del grupo:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener los miembros del grupo', error });
		}
	}
// Método para eliminar un grupo
private async deleteGroup(req: AuthRequest, res: Response): Promise<Response> {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
    }

    const { groupId } = req.params;

    const group = await this.groupModel.findById(groupId).exec();
    if (!group) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });
    }

    // Verificar permisos: creador o admin
    const isCreator = group.createdBy.toString() === userId;
    const isAdmin = group.admins.map(id => id.toString()).includes(userId);

    if (!isCreator && !isAdmin) {
      return res.status(StatusCodes.FORBIDDEN).json({ message: 'No tienes permiso para eliminar este grupo' });
    }

    // Eliminar el grupo
    await this.groupModel.deleteOne({ _id: group._id });

    return res.status(StatusCodes.OK).json({
      message: 'Grupo eliminado correctamente',
      groupId: groupId,
    });
  } catch (error) {
    console.error('Error al eliminar el grupo:', error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'Error al eliminar el grupo', error });
  }
}

private async leaveGroup(req: AuthRequest, res: Response): Promise<Response> {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
    }
    const { groupId } = req.params;

    const group = await this.groupModel.findById(groupId);
    if (!group) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });
    }

    // (opcional) impedir que el creador salga
    // if (group.createdBy.toString() === userId) {
    //   return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El creador no puede salir: elimina o transfiere el grupo.' });
    // }

    const selfId = new mongoose.Types.ObjectId(userId);
    if (!group.members.includes(selfId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'No eres miembro del grupo' });
    }

    group.members = group.members.filter((m) => !m.equals(selfId));
   group.admins  = group.admins.filter((a) => !a.equals(selfId));

    await group.save();
    return res.status(StatusCodes.OK).json({ group });
  } catch (error) {
    console.error('Error al salir del grupo:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al salir del grupo', error });
  }
}
// Otorgar admin a un usuario (solo creador)
private async grantGroupAdmin(req: AuthRequest, res: Response): Promise<Response> {
  try {
    const userId = req.userId;
    if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });

    const { groupId } = req.params;
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'targetUserId es requerido' });
    }

    const group = await this.groupModel.findById(groupId);
    if (!group) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });

    // Solo el creador puede gestionar admins
    if (group.createdBy.toString() !== userId) {
      return res.status(StatusCodes.FORBIDDEN).json({ message: 'Solo el creador puede asignar administradores' });
    }

    const targetObjId = new mongoose.Types.ObjectId(targetUserId);

    // Debe ser miembro para ser admin
    if (!group.members.some(m => m.equals(targetObjId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El usuario debe ser miembro del grupo' });
    }

    // Ya es admin?
    if (group.admins.some(a => a.equals(targetObjId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El usuario ya es administrador' });
    }

    group.admins.push(targetObjId);
    await group.save();

    return res.status(StatusCodes.OK).json({ group, message: 'Administrador asignado' });
  } catch (error) {
    console.error('Error al otorgar admin:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al otorgar admin', error });
  }
}

// Revocar admin a un usuario (solo creador)
private async revokeGroupAdmin(req: AuthRequest, res: Response): Promise<Response> {
  try {
    const userId = req.userId;
    if (!userId) return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });

    const { groupId } = req.params;
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'targetUserId es requerido' });
    }

    const group = await this.groupModel.findById(groupId);
    if (!group) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Grupo no encontrado' });

    // Solo el creador puede gestionar admins
    if (group.createdBy.toString() !== userId) {
      return res.status(StatusCodes.FORBIDDEN).json({ message: 'Solo el creador puede revocar administradores' });
    }

    const targetObjId = new mongoose.Types.ObjectId(targetUserId);

    // No permitir revocarte al creador (no está en admins normalmente, pero por si acaso)
    if (group.createdBy.equals(targetObjId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'No puedes revocar al creador' });
    }

    const before = group.admins.length;
    group.admins = group.admins.filter(a => !a.equals(targetObjId));

    if (group.admins.length === before) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El usuario no es administrador' });
    }

    await group.save();
    return res.status(StatusCodes.OK).json({ group, message: 'Administrador revocado' });
  } catch (error) {
    console.error('Error al revocar admin:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al revocar admin', error });
  }
}

}

export default GroupController;

