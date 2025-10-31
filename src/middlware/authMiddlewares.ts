// src/middleware/authMiddlewares.ts
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UserModel } from '../routes/schemas/user';
import { verifyToken, TokenPayload } from '../authentication/authUser';
import mongoose from 'mongoose';

// Extender la interfaz Request para incluir userId y userPermissions
interface AuthRequest extends Request {
  userId?: string;
  userPermissions?: Set<string>;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<Response | void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'No se proporcionó un token de autorización' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token) as TokenPayload;
    const userId = payload.userId;
    req.userId = userId; // Guardar el userId en la solicitud para usarlo posteriormente

    // Obtener el usuario y sus roles y permisos
    const user = await UserModel(mongoose)
      .findById(userId)
      .populate({
        path: 'roles',
        populate: {
          path: 'permissions',
          populate: [{ path: 'module' }, { path: 'action' }],
        },
      })
      .exec();

    if (!user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Usuario no encontrado' });
    }

    if (user.status === 'deactivated') {
      return res.status(StatusCodes.FORBIDDEN).json({ error: 'Tu cuenta está desactivada. Contacta al administrador.' });
    }

    if (user.status === 'blacklisted') {
      return res.status(StatusCodes.FORBIDDEN).json({ error: 'Has sido bloqueado del sistema.' });
    }

    // Extraer los permisos del usuario
    req.userPermissions = getUserPermissions(user);

    // Continuar con el siguiente middleware si el usuario está autenticado
    next();
  } catch (error) {
    console.error('Error en el middleware de autenticación:', error);
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Token de autorización inválido' });
  }
}

// Función para obtener los permisos del usuario
const getUserPermissions = (user: any): Set<string> => {
  const permissions = new Set<string>();
  if (user.roles && Array.isArray(user.roles)) {
    user.roles.forEach((role: any) => {
      //console.log(`Rol del usuario: ${role.name}`);
      if (role.permissions && Array.isArray(role.permissions)) {
        role.permissions.forEach((permission: any) => {
          if (permission.module && permission.action) {
            const moduleName = permission.module.name;
            const actionName = permission.action.name;
            const permissionString = `${moduleName}:${actionName}`;
            permissions.add(permissionString);
           // console.log(`Permiso agregado: ${permissionString}`);
          } else {
            //console.warn('Permiso incompleto: falta módulo o acción.');
            //console.warn('Detalles del permiso incompleto:', permission);
          }
        });
      } else {
        console.warn('El rol no tiene permisos asignados o permisos no es un arreglo.');
      }
    });
  } else {
    console.warn('El usuario no tiene roles asignados o roles no es un arreglo.');
  }
  //console.log('Permisos del usuario:', Array.from(permissions));
  return permissions;
};

export const adminMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
    }

    // Utilizar mongoose directamente
    const user = await UserModel(mongoose).findById(userId).populate('roles').exec();

    if (!user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no encontrado' });
    }

    // Verificar si el usuario tiene el rol de administrador
    const isAdmin = user.roles.some((role: any) => role.name === 'admi');

    if (!isAdmin) {
      return res.status(StatusCodes.FORBIDDEN).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
    }

    // El usuario es administrador, continuar con la solicitud
    next();
  } catch (error) {
    console.error('Error en adminMiddleware:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error en la verificación de permisos' });
  }
};

