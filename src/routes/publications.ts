import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { PublicationModel, IPublication } from './schemas/publication';
import App from '../app';
import { authMiddleware, adminMiddleware } from '../middlware/authMiddlewares';
//import { upload } from '../middlware/upload';
import { getUploadMiddleware } from '../middlware/upload';
import { UserModel, IUser } from './schemas/user';
import { ReportModel } from './schemas/report';

import mongoose, { Schema, Document, Types } from 'mongoose'; // Asegúrate de que mongoose está importado
import { analyzeImage } from '../moderation/images/nudenetService';
import { analyzeVideo } from "../moderation/videos/nudenetVideoService";
import { SettingsModel } from './schemas/settings';
import {dynamicPermissionMiddleware} from '../middlware/permissionMiddleware';
import { analyzeComment } from '../moderation/text/toxicityService';
import { translateText } from '../moderation/text/translationService';
import SocketController from './socket';
import { NotificationModel } from './schemas/notification';


import fs from 'fs/promises';

interface AuthRequest extends Request {
	userId?: string;
}

export class PublicationController {
	private route: string;
	private app: App;
	private publicationModel: ReturnType<typeof PublicationModel>;
		private notificationModel: ReturnType<typeof NotificationModel>;

		private socketController: SocketController;

	constructor(app: App, route: string, socketController:SocketController) {
		this.route = route;
		this.app = app;
						this.notificationModel = NotificationModel(this.app.getClientMongoose());
		this.socketController = socketController;

		this.publicationModel = PublicationModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {
		// Ruta para crear una nueva publicación
		this.app.getAppServer().post(
			`${this.route}/publications`,
			authMiddleware,
			async (req, res, next) => {
				// Obtén el maxUploadSize desde la base de datos
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 50 * 1024 * 1024;

				// Obtén el middleware de subida con el tamaño actualizado
				const upload = getUploadMiddleware(maxUploadSize);

				// Llama al middleware de multer
				upload.single('file')(req, res, (err) => {
					if (err) {
						return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					}
					next();
				});
			},
			this.createPublication.bind(this)
		);		
		// Ruta para obtener todas las publicaciones

		this.app.getAppServer().get(
			`${this.route}/publications`,
			authMiddleware, dynamicPermissionMiddleware,
			this.listPublications.bind(this)
		);
		// Ruta para obtener las publicaciones del usuario autenticado
		this.app.getAppServer().get(
			`${this.route}/user-publications`, // Nueva ruta
			authMiddleware,
			this.listUserPublications.bind(this) // Llama al método que filtra por usuario autenticado
		);
		// Ruta para buscar publicaciones
		this.app.getAppServer().get( `${this.route}/publications/search`, authMiddleware, this.searchPublications.bind(this));
		// Ruta para obtener el estado actual del moderador de IA
		this.app.getAppServer().get( `${this.route}/moderation-status`, authMiddleware, this.getModerationStatus.bind(this));

		// Ruta para actualizar el estado del moderador de IA
		this.app.getAppServer().put( `${this.route}/moderation-status`, authMiddleware, this.updateModerationStatus.bind(this));

		//esta rutas deben ir mas antes que las rutas genericas: ej. /publications/:id.

		// Ruta para listar publicaciones más gustadas
		this.app.getAppServer().get( `${this.route}/publications/most-liked`, authMiddleware, this.listMostLikedPublications.bind(this));

		// Ruta para listar publicaciones más comentadas
		this.app.getAppServer().get( `${this.route}/publications/most-commented`, authMiddleware, this.listMostCommentedPublications.bind(this));

		// Ruta para actualizar una publicación existente
		this.app.getAppServer().put( `${this.route}/publications/:id`, authMiddleware, dynamicPermissionMiddleware, this.updatePublication.bind(this));

		// Ruta para eliminar una publicación
		this.app.getAppServer().delete( `${this.route}/publications/:id`, authMiddleware,dynamicPermissionMiddleware, this.deletePublication.bind(this));

		// Ruta para actualizar una publicación existente
		this.app.getAppServer().put( `${this.route}/user-publications/:id`, authMiddleware, dynamicPermissionMiddleware,
			async (req, res, next) => {
				// Obtén el maxUploadSize desde la base de datos
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 50 * 1024 * 1024;

				// Obtén el middleware de subida con el tamaño actualizado
				const upload = getUploadMiddleware(maxUploadSize);

				// Llama al middleware de multer
				upload.single('file')(req, res, (err) => {
					if (err) {
						return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					}
					next();
				});
			},
			this.updateUserPublication.bind(this)
		);
		// Ruta para obtener una publicación por ID
		this.app.getAppServer().get( `${this.route}/publications/:publicationId`, authMiddleware, this.getPublicationById.bind(this));

		// Ruta para eliminar una publicación
		this.app.getAppServer().delete( `${this.route}/publications/:id`, authMiddleware, this.deleteUserPublication.bind(this));


		this.app.getAppServer().get( `${this.route}/publications/career/:careerId`, authMiddleware, this.listPublicationsByCareer.bind(this));

		// Ruta para reportar una publicación
		this.app.getAppServer().post( `${this.route}/publications/:publicationId/report`, authMiddleware, this.reportPublication.bind(this));

		// Ruta para dar like a una publicación
		this.app.getAppServer().post(`${this.route}/publications/:publicationId/like`, authMiddleware, this.likePublication.bind(this));

		// Ruta para quitar el like a una publicación
		this.app.getAppServer().post(`${this.route}/publications/:publicationId/unlike`,authMiddleware,this.unlikePublication.bind(this));


	}

	// Método para listar todas las publicaciones
private async listPublications(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;
    const { tag, tags, careerId, page = 1, limit = 10 } = req.query;

    const User = UserModel(this.app.getClientMongoose());

    const normalizeTag = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .toLowerCase();

    let tagsArray: string[] = [];
    if (typeof tag === "string") tagsArray.push(normalizeTag(tag));
    if (typeof tags === "string")
      tagsArray = tagsArray.concat(
        tags
          .split(",")
          .map((t) => normalizeTag(t))
          .filter((t) => t.length > 0)
      );

    const usersWhoBlockedMe = await User.find({ blockedUsers: userId })
      .select("_id")
      .exec();
    const blockedByUserIds = usersWhoBlockedMe.map((user) => user._id);

    const me = await User.findById(userId).select("blockedUsers").exec();
    const myBlockedUserIds = me ? me.blockedUsers : [];

    const excludedUserIds = blockedByUserIds.concat(myBlockedUserIds);

    const filter: Record<string, any> = {
      author: { $nin: excludedUserIds },
    };

    // Filtro por tags
    if (tagsArray.length > 0) {
      filter.tags = { $in: tagsArray };
    }

    // Filtro por carrera (opcional)
    if (careerId && typeof careerId === "string") {
      filter.career = careerId;
    }

    const pageNum = Number(page) > 0 ? Number(page) : 1;
    const limitNum = Number(limit) > 0 ? Number(limit) : 10;
    const skip = (pageNum - 1) * limitNum;

    const publications = await this.publicationModel
      .find(filter)
      .populate({
        path: "author",
        select: "username",
        populate: {
          path: "profile",
          select: "profilePicture",
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .exec();

    // Total para paginación (solo si se usa page/limit)
    const total = await this.publicationModel.countDocuments(filter).exec();

    res.status(StatusCodes.OK).json({
      publications,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error al listar las publicaciones:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: "Error al listar las publicaciones", error });
  }
}

	// Método para crear una nueva publicación

private async createPublication(req: AuthRequest, res: Response): Promise<Response> {
  const deleteIfExists = async (p?: string) => {
    if (!p) return;
    try { await fs.unlink(p); } catch { /* ignore */ }
  };

  try {
    const { title, content, tags, careerId, language = 'es' } = req.body;
    const userId = req.userId;
    const file = req.file;

    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
    }

    if (!title || !content) {
      await deleteIfExists(file?.path);
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El título y contenido son obligatorios' });
    }

    // Obtener usuario y sus carreras
    const user = await UserModel(this.app.getClientMongoose()).findById(userId).exec();
    if (!user) {
      await deleteIfExists(file?.path);
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no encontrado' });
    }

    const careers = Array.isArray(user.careers) ? user.careers : [];

    let careerToUse: mongoose.Types.ObjectId | null = null;
    let audience: 'guest' | 'university' = 'guest';

    if (careers.length === 0) {
      audience = 'guest';
    }
    else if (careers.length === 1) {
      audience = 'university';
      careerToUse = careers[0];
    }
    else if (careerId) {
      if (careers.some((id) => id.toString() === careerId)) {
        audience = 'university';
        careerToUse = careerId;
      } else {
        await deleteIfExists(file?.path);
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: 'La carrera seleccionada no pertenece al usuario',
        });
      }
    } else {
      await deleteIfExists(file?.path);
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: 'Debes seleccionar la carrera para esta publicación',
      });
    }

    // === Settings ===
    const Settings = SettingsModel(this.app.getClientMongoose());
    const settings = await Settings.findOne().exec();

    const aiModerationEnabled = settings?.aiModerationEnabled ?? true;
    const textModerationEnabled =
      (settings as any)?.publicationTextModerationEnabled ??
      settings?.commentModerationEnabled ??
      true;

    // === Moderación de ARCHIVOS (igual que antes, pero borrando si se rechaza) ===
    if (file && aiModerationEnabled) {
      if (file.mimetype.startsWith('image/')) {
        const isNSFW = await analyzeImage(file.path);
        if (isNSFW) {
          await deleteIfExists(file.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en la imagen' });
        }
      }
      if (file.mimetype.startsWith('video/')) {
        const isNSFW = await analyzeVideo(file.path);
        if (isNSFW) {
          await deleteIfExists(file.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en el video' });
        }
      }
    }

    // === Parseo de tags (una sola vez) ===
    let parsedTags: string[] = [];
    if (typeof tags === 'string') {
      if (tags.trim().length > 0) {
        try {
          const maybe = JSON.parse(tags);
          if (Array.isArray(maybe)) {
            parsedTags = maybe.map((t: any) => String(t).trim()).filter(Boolean);
          } else {
            return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Formato de tags inválido, se esperaba un array.' });
          }
        } catch (e) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Formato de tags inválido (JSON no válido).' });
        }
      }
    }

    // === Moderación de TEXTO (título, contenido, tags) como comentarios ===
    if (textModerationEnabled) {
      // Título
      if (typeof title === 'string' && title.trim().length > 0) {
        let titleToCheck = title;
        if (language && language !== 'en') {
          try {
            titleToCheck = await translateText(title, 'en');
          } catch (e) {
            console.error('Error en la traducción del título:', e);
          }
        }
        const badTitle = await analyzeComment(titleToCheck);
        if (badTitle) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El título contiene lenguaje inapropiado.' });
        }
      }

      // Contenido
      if (typeof content === 'string' && content.trim().length > 0) {
        let contentToCheck = content;
        if (language && language !== 'en') {
          try {
            contentToCheck = await translateText(content, 'en');
          } catch (e) {
            console.error('Error en la traducción del contenido:', e);
          }
        }
        const badContent = await analyzeComment(contentToCheck);
        if (badContent) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El contenido contiene lenguaje inapropiado.' });
        }
      }

      // Tags (cada uno)
      const badTags: string[] = [];
      for (const tag of parsedTags) {
        let tagToCheck = tag;
        if (language && language !== 'en') {
          try {
            tagToCheck = await translateText(tag, 'en');
          } catch (e) {
            console.error('Error en la traducción del tag:', e);
          }
        }
        const tagBad = await analyzeComment(tagToCheck);
        if (tagBad) badTags.push(tag);
      }

      if (badTags.length > 0) {
        await deleteIfExists(file?.path);
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: 'Algunas etiquetas contienen lenguaje inapropiado.',
          invalid: badTags,
        });
      }
    }

    const urlBase = process.env.PUBLIC_URL || 'https://tu-dominio.com';
    const fileUrl = file ? `${urlBase}/${file.path}` : undefined;

    const newPublication = new this.publicationModel({
      title,
      content,
      author: userId,
      tags: parsedTags,
      filePath: file?.path,
      fileType: file?.mimetype,
      career: careerToUse,      // null si es invitado
      audience,                 // 'guest' o 'university'
      fileUrl,
    });

    const result = await newPublication.save();
    await result.populate({
      path: 'author',
      select: 'username',
      populate: { path: 'profile', select: 'profilePicture' }
    });

    return res.status(StatusCodes.CREATED).json({ publication: result });
  } catch (error) {
    console.error('Error al crear la publicación:', error);
    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch { /* ignore */ }
    }
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Error al crear la publicación', error });
  }
}


	private async updatePublication(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const { title, content, tags } = req.body;
			const updatedPublication = await this.publicationModel.findByIdAndUpdate(
				id,
				{ title, content, tags },
				{ new: true }
			).exec();
			res.status(StatusCodes.OK).json({ publication: updatedPublication });
		} catch (error) {
			res.status(StatusCodes.BAD_REQUEST).json({ message: 'Error al actualizar la publicación', error });
		}
	}

	// Método para eliminar una publicación
	private async deletePublication(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			await this.publicationModel.findByIdAndDelete(id).exec();
			res.status(StatusCodes.OK).json({ message: 'Publicación eliminada correctamente' });
		} catch (error) {
			res.status(StatusCodes.BAD_REQUEST).json({ message: 'Error al eliminar la publicación', error });
		}
	}
	// Cambia el tipo de retorno de Promise<void> a Promise<Response>
	private async listUserPublications(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId; // Obtén el userId del usuario autenticado

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			// Filtra las publicaciones por el userId del usuario autenticado
			const publications = await this.publicationModel.find({ author: userId }).exec();

			return res.status(StatusCodes.OK).json({ publications });
		} catch (error) {
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al listar las publicaciones del usuario', error });
		}
	}

	// Método para editar una publicación del usuario autenticado

private async updateUserPublication(req: AuthRequest, res: Response): Promise<Response> {
  const deleteIfExists = async (p?: string) => {
    if (!p) return;
    try { await fs.unlink(p); } catch { /* ignore */ }
  };

  try {
    const { id } = req.params;
    const { title, content, tags, language = 'es' } = req.body;
    const userId = req.userId;
    const file = req.file;

    // Verifica si la publicación existe y si pertenece al usuario autenticado
    const publication = await this.publicationModel.findOne({ _id: id, author: userId }).exec();
    if (!publication) {
      if (file?.path) await deleteIfExists(file.path);
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'No tienes permiso para editar esta publicación' });
    }

    // === Settings ===
    const Settings = SettingsModel(this.app.getClientMongoose());
    const settings = await Settings.findOne().exec();

    const aiModerationEnabled = settings?.aiModerationEnabled ?? true;
    const textModerationEnabled =
      (settings as any)?.publicationTextModerationEnabled ??
      settings?.commentModerationEnabled ??
      true;

    // === Moderación de ARCHIVO (si sube uno nuevo) ===
    if (file && aiModerationEnabled) {
      if (file.mimetype.startsWith('image/')) {
        const isNSFW = await analyzeImage(file.path);
        if (isNSFW) {
          await deleteIfExists(file.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en la imagen' });
        }
      } else if (file.mimetype.startsWith('video/')) {
        const isNSFW = await analyzeVideo(file.path);
        if (isNSFW) {
          await deleteIfExists(file.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Contenido inapropiado detectado en el video' });
        }
      }
    }

    // === Parseo de tags (si vienen) ===
    let parsedTags: string[] | undefined = undefined;
    if (typeof tags === 'string') {
      if (tags.trim().length > 0) {
        try {
          const maybe = JSON.parse(tags);
          if (Array.isArray(maybe)) {
            parsedTags = maybe.map((t: any) => String(t).trim()).filter(Boolean);
          } else {
            await deleteIfExists(file?.path);
            return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Formato de tags inválido, se esperaba un array.' });
          }
        } catch (e) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Formato de tags inválido (JSON no válido).' });
        }
      } else {
        parsedTags = []; // limpiar tags si mandan string vacío
      }
    }

    // === Moderación de TEXTO (título, contenido, tags nuevos) ===
    if (textModerationEnabled) {
      // Título (solo si viene en request)
      if (typeof title === 'string' && title.trim().length > 0) {
        let titleToCheck = title;
        if (language && language !== 'en') {
          try {
            titleToCheck = await translateText(title, 'en');
          } catch (e) {
            console.error('Error en la traducción del título (update):', e);
          }
        }
        const badTitle = await analyzeComment(titleToCheck);
        if (badTitle) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El título contiene lenguaje inapropiado.' });
        }
      }

      // Contenido (solo si viene en request)
      if (typeof content === 'string' && content.trim().length > 0) {
        let contentToCheck = content;
        if (language && language !== 'en') {
          try {
            contentToCheck = await translateText(content, 'en');
          } catch (e) {
            console.error('Error en la traducción del contenido (update):', e);
          }
        }
        const badContent = await analyzeComment(contentToCheck);
        if (badContent) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El contenido contiene lenguaje inapropiado.' });
        }
      }

      // Tags (si se enviaron)
      if (parsedTags) {
        const badTags: string[] = [];
        for (const tag of parsedTags) {
          if (!tag) continue;
          let tagToCheck = tag;
          if (language && language !== 'en') {
            try {
              tagToCheck = await translateText(tag, 'en');
            } catch (e) {
              console.error('Error en la traducción del tag (update):', e);
            }
          }
          const tagBad = await analyzeComment(tagToCheck);
          if (tagBad) badTags.push(tag);
        }

        if (badTags.length > 0) {
          await deleteIfExists(file?.path);
          return res.status(StatusCodes.BAD_REQUEST).json({
            message: 'Algunas etiquetas contienen lenguaje inapropiado.',
            invalid: badTags,
          });
        }
      }
    }

    // === Construir updateData sin romper nada (solo actualiza lo que venga) ===
    const updateData: Partial<IPublication> = {};

    if (typeof title === 'string') {
      updateData.title = title;
    }
    if (typeof content === 'string') {
      updateData.content = content;
    }
    if (parsedTags !== undefined) {
      updateData.tags = parsedTags;
    }

    if (file) {
      updateData.filePath = file.path;
      updateData.fileType = file.mimetype;
    }

    console.log('Datos de actualización:', updateData);

    // Guarda los cambios
    const updatedPublication = await this.publicationModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).exec();

    console.log('Publicación actualizada:', updatedPublication);
    return res.status(StatusCodes.OK).json({ publication: updatedPublication });
  } catch (error) {
    console.error('Error al editar la publicación:', error);
    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch { /* ignore */ }
    }
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al editar la publicación', error });
  }
}

	// Método para eliminar una publicación del usuario autenticado
	private async deleteUserPublication(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const userId = req.userId;

			const publication = await this.publicationModel.findOne({ _id: id, author: userId }).exec();
			if (!publication) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'No tienes permiso para eliminar esta publicación' });
			}

			await this.publicationModel.findByIdAndDelete(id).exec();
			return res.status(StatusCodes.OK).json({ message: 'Publicación eliminada correctamente' });
		} catch (error) {
			console.error('Error al eliminar la publicación:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar la publicación', error });
		}
	}

	// Método para listar publicaciones por carrera
	private async listPublicationsByCareer(req: AuthRequest, res: Response): Promise<void> {
		try {
			const { careerId } = req.params;
			const publications = await this.publicationModel
			.find({ career: careerId })
			.populate({
				path: 'author',
				select: 'username',
				populate: {
					path: 'profile',
					select: 'profilePicture'
				}
			})
			.exec();
			res.status(StatusCodes.OK).json({ publications });
		} catch (error) {
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al listar las publicaciones', error });
		}
	}
	// Método para obtener el estado actual del moderador de IA
	private async getModerationStatus(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const Settings = SettingsModel(this.app.getClientMongoose());
			const settings = await Settings.findOne().exec();
			const aiModerationEnabled = settings?.aiModerationEnabled ?? true;
			return res.status(StatusCodes.OK).json({ aiModerationEnabled });
		} catch (error) {
			console.error('Error al obtener el estado del moderador de IA:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener el estado del moderador de IA', error });
		}
	}

	// Método para actualizar el estado del moderador de IA
	private async updateModerationStatus(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { aiModerationEnabled } = req.body;

			if (typeof aiModerationEnabled !== 'boolean') {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El valor de aiModerationEnabled debe ser booleano' });
			}

			const Settings = SettingsModel(this.app.getClientMongoose());
			let settings = await Settings.findOne().exec();

			if (!settings) {
				settings = new Settings({ aiModerationEnabled });
			} else {
				settings.aiModerationEnabled = aiModerationEnabled;
			}

			await settings.save();

			return res.status(StatusCodes.OK).json({ message: 'Estado del moderador de IA actualizado', aiModerationEnabled });
		} catch (error) {
			console.error('Error al actualizar el estado del moderador de IA:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar el estado del moderador de IA', error });
		}
	}
	private async getPublicationById(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { publicationId } = req.params;
			const publication = await this.publicationModel
			.findById(publicationId)
			.populate('author')
			.exec();

			if (!publication) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Publicación no encontrada' });
			}

			return res.status(StatusCodes.OK).json({ publication });
		} catch (error) {
			console.error('Error al obtener la publicación:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener la publicación', error });
		}
	}
	private async reportPublication(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { publicationId } = req.params;
			const { reason } = req.body;
			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			if (!reason) {
				return res.status(StatusCodes.BAD_REQUEST).json({ message: 'La razón del reporte es obligatoria' });
			}

			// Verificar si la publicación existe
			const publication = await this.publicationModel.findById(publicationId).exec();
			if (!publication) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Publicación no encontrada' });
			}

			// Crear un nuevo reporte
			const Report = ReportModel(this.app.getClientMongoose());
			const newReport = new Report({
				reporter: userId,
				target: publicationId,     
				targetType: 'Publication',
				reason,
				status: 'pending',
			});

			await newReport.save();

			// Actualizar el contador y el listado de usuarios únicos en el autor de la publicación
			const authorId = publication.author as Types.ObjectId; // Aseguramos que es un ObjectId
			const userModel = UserModel(this.app.getClientMongoose());
			const user = await userModel.findById(authorId);

			if (user) {
				const userIdObject = new mongoose.Types.ObjectId(userId);

				// Verificar si el usuario ya ha reportado anteriormente
				const hasReported = user.uniqueReporters.some((reporterId) => reporterId.equals(userIdObject));

				if (!hasReported) {
					user.uniqueReporters.push(userIdObject);
					user.reportCount += 1;

					await user.save();

					// Lógica para evaluar si el usuario debe ser bloqueado o eliminado
					await this.checkAndUpdateUserStatus(user);
				}
			} else {
				console.error('Usuario autor no encontrado');
			}  

			return res.status(StatusCodes.CREATED).json({ message: 'Reporte enviado correctamente' });
		} catch (error) {
			console.error('Error al reportar la publicación:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al reportar la publicación', error });
		}
	}
	// En checkAndUpdateUserStatus asegúrate de que IUser esté importado
	private async checkAndUpdateUserStatus(user: IUser): Promise<void> {
		const Settings = SettingsModel(this.app.getClientMongoose());
		const settings = await Settings.findOne().exec();

		if (!settings) {
			console.error('No se encontraron los ajustes de configuración.');
			return;
		}

		const reportThreshold = settings.reportThreshold;
		const notificationThreshold = settings.notificationThreshold;

		if (user.reportCount >= reportThreshold) {
			user.status = 'blacklisted';
			await user.save();
			console.log(`Usuario ${user._id} ha sido bloqueado por exceso de reportes.`);
			// Implementa aquí la lógica adicional si es necesario
		} else if (user.reportCount >= notificationThreshold) {
			// Enviar notificación al usuario
			await this.notifyUser(user);
		}
	}
	// Método para notificar al usuario
	private async notifyUser(user: IUser): Promise<void> {
		// Implementa la lógica para enviar una notificación al usuario
		// Por ejemplo, puedes enviar un correo electrónico o una notificación en la aplicación
		console.log(`Enviando notificación al usuario ${user._id} por reportes acumulados.`);
	}
	// Método para dar like a una publicación
private async likePublication(req: AuthRequest, res: Response): Promise<Response> {
	try {
		const { publicationId } = req.params;
		const userId = req.userId;

		if (!userId) {
			return res
				.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'Usuario no autenticado' });
		}

		const userObjectId = new mongoose.Types.ObjectId(userId);

		// 1) Buscar la publicación primero
		const publication = await this.publicationModel
			.findById(publicationId)
			.exec();

		if (!publication) {
			return res
				.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Publicación no encontrada' });
		}

		// 2) Verificar si ya había dado like
		const alreadyLiked = publication.likes.some((id: mongoose.Types.ObjectId) =>
			id.equals(userObjectId)
		);

		if (alreadyLiked) {
			// No duplicamos likes ni likesCount
			return res.status(StatusCodes.OK).json({
				message: 'Ya habías dado like a esta publicación',
				likesCount: publication.likes.length,
			});
		}

		// 3) Agregar like y actualizar contador
		publication.likes.push(userObjectId);
		// por si likesCount no existe o está desfasado
		publication.likesCount = (publication.likesCount ?? publication.likes.length);
		await publication.save();

		// Solo notificamos si el que da like NO es el autor
		const authorId = publication.author?.toString?.() ?? publication.author;

		if (authorId && authorId !== userId) {
			// Obtener username del que dio like
			const User = UserModel(this.app.getClientMongoose());
			const liker = await User.findById(userId).select('username').exec();
			const likerName = liker?.username ?? 'Un usuario';

			const notification = new this.notificationModel({
				recipient: authorId,               // autor de la publicación
				sender: userObjectId,              // quien dio like
				type: 'publication_liked',         
				message: `${likerName} le ha dado like a tu publicación`,
				data: { publicationId: publication._id },
			});

			await notification.save();

			this.socketController.emitNotification(
				authorId.toString(),
				notification
			);
		}

		return res.status(StatusCodes.OK).json({
			message: 'Has dado like a la publicación',
			likesCount: publication.likes.length,
		});
	} catch (error) {
		console.error('Error al dar like a la publicación:', error);
		return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
			message: 'Error al dar like a la publicación',
			error,
		});
	}
}


	private async unlikePublication(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { publicationId } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED)
				.json({ message: 'Usuario no autenticado' });
			}

			const userObjectId = new mongoose.Types.ObjectId(userId);

			const publication = await this.publicationModel.findByIdAndUpdate(
				publicationId,
				{
					$pull: { likes: userObjectId },   // ← quita
					$inc : { likesCount: -1 },        // ← –1
				},
				{ new: true }
			).exec();

			if (!publication) {
				return res.status(StatusCodes.NOT_FOUND)
				.json({ message: 'Publicación no encontrada' });
			}

			return res.status(StatusCodes.OK).json({
				message    : 'Has quitado el like a la publicación',
				likesCount : publication.likes.length,
			});

		} catch (error) {
			console.error('Error al quitar el like a la publicación:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
				message: 'Error al quitar el like a la publicación',
				error,
			});
		}
	}

private async searchPublications(req: Request, res: Response): Promise<Response> {
  try {
    const { query, tag, tags, careerId, page = 1, limit = 10 } = req.query;

    const normalizeTag = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .toLowerCase();

    let tagsArray: string[] = [];
    if (typeof tag === "string") tagsArray.push(normalizeTag(tag));
    if (typeof tags === "string")
      tagsArray = tagsArray.concat(
        tags
          .split(",")
          .map((t) => normalizeTag(t))
          .filter((t) => t.length > 0)
      );

    // Base de filtro
    const filter: Record<string, any> = {};

    if (query && typeof query === "string" && query.trim() !== "") {
      filter.$text = { $search: query.trim() };
    }

    if (tagsArray.length > 0) {
      // Si hay búsqueda y tags, combinamos con $and
      if (filter.$text) {
        filter.$and = [{ tags: { $in: tagsArray } }];
      } else {
        filter.tags = { $in: tagsArray };
      }
    }

    if (careerId && typeof careerId === "string") {
      filter.career = careerId;
    }

    const pageNum = Number(page) > 0 ? Number(page) : 1;
    const limitNum = Number(limit) > 0 ? Number(limit) : 10;
    const skip = (pageNum - 1) * limitNum;

    const publications = await this.publicationModel
      .find(filter, filter.$text ? { score: { $meta: "textScore" } } : {})
      .sort(filter.$text ? { score: { $meta: "textScore" } } : { createdAt: -1 })
      .populate({
        path: "author",
        select: "username",
        populate: {
          path: "profile",
          select: "profilePicture",
        },
      })
      .skip(skip)
      .limit(limitNum)
      .exec();

    const total = await this.publicationModel.countDocuments(filter).exec();

    return res.status(StatusCodes.OK).json({
      publications,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error al buscar publicaciones:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: "Error al buscar publicaciones", error });
  }
}

	private async listMostLikedPublications(req: AuthRequest, res: Response): Promise<void> {
		try {
			const userId = req.userId;

			const User = UserModel(this.app.getClientMongoose());

			// Obtener usuarios bloqueados y que han bloqueado al usuario actual
			const usersWhoBlockedMe = await User.find({ blockedUsers: userId }).select('_id').exec();
			const blockedByUserIds = usersWhoBlockedMe.map(user => user._id);

			const me = await User.findById(userId).select('blockedUsers').exec();
			const myBlockedUserIds = me ? me.blockedUsers : [];

			const excludedUserIds = blockedByUserIds.concat(myBlockedUserIds);

			// Obtener publicaciones excluyendo las de usuarios bloqueados y ordenar por likesCount
			const publications = await this.publicationModel.find({
				author: { $nin: excludedUserIds }
			})
			.populate({
				path: 'author',
				select: 'username',
				populate: {
					path: 'profile',
					select: 'profilePicture'
				}
			})
			.sort({ likesCount: -1 }) // Ordenar por likesCount descendente
			.exec();

			res.status(StatusCodes.OK).json({ publications });
		} catch (error) {
			console.error('Error al listar las publicaciones más gustadas:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al listar las publicaciones más gustadas', error });
		}
	}

	private async listMostCommentedPublications(req: AuthRequest, res: Response): Promise<void> {
		try {
			const userId = req.userId;

			const User = UserModel(this.app.getClientMongoose());

			// Obtener usuarios bloqueados y que han bloqueado al usuario actual
			const usersWhoBlockedMe = await User.find({ blockedUsers: userId }).select('_id').exec();
			const blockedByUserIds = usersWhoBlockedMe.map(user => user._id);

			const me = await User.findById(userId).select('blockedUsers').exec();
			const myBlockedUserIds = me ? me.blockedUsers : [];

			const excludedUserIds = blockedByUserIds.concat(myBlockedUserIds);

			// Obtener publicaciones excluyendo las de usuarios bloqueados y ordenar por commentsCount
			const publications = await this.publicationModel.find({
				author: { $nin: excludedUserIds }
			})
			.populate({
				path: 'author',
				select: 'username',
				populate: {
					path: 'profile',
					select: 'profilePicture'
				}
			})
			.sort({ commentsCount: -1 }) // Ordenar por commentsCount descendente
			.exec();

			res.status(StatusCodes.OK).json({ publications });
		} catch (error) {
			console.error('Error al listar las publicaciones más comentadas:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al listar las publicaciones más comentadas', error });
		}
	}
}

