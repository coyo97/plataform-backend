import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ProfileModel, IProfile } from './schemas/profile'; 
import { Types } from 'mongoose';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';
import { getUploadMiddleware } from '../middlware/upload';
import { SettingsModel } from './schemas/settings';
import path from 'path';
import fs from 'fs/promises';

import { UserModel } from './schemas/user';
import {dynamicPermissionMiddleware} from '../middlware/permissionMiddleware';

interface AuthRequest extends Request {
	userId?: string;
}

export class ProfileController {
	private route: string;
	private app: App;
	private profileModel: ReturnType<typeof ProfileModel>;

	private userModel: ReturnType<typeof UserModel>;

	constructor(app: App, route: string) {
		this.route = route;
		this.app = app;
		this.profileModel = ProfileModel(this.app.getClientMongoose());

		this.userModel = UserModel(this.app.getClientMongoose());
		this.initRoutes();
	}

	private initRoutes(): void {

		this.app.getAppServer().get(`${this.route}/profile`, authMiddleware, this.getProfile.bind(this));

		this.app.getAppServer().put(
			`${this.route}/profile`, authMiddleware,
			async (req, res, next) => {
				const Settings = SettingsModel(this.app.getClientMongoose());
				const settings = await Settings.findOne().exec();
				const maxUploadSize = settings?.maxUploadSize ?? 50 * 1024 * 1024;

				const upload = getUploadMiddleware(maxUploadSize);

				upload.single('file')(req, res, (err) => {
					if (err) {
						return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
					}
					next();
				});
			}, this.updateProfile.bind(this)
		);

		this.app.getAppServer().get(`${this.route}/authors/:id`, authMiddleware, dynamicPermissionMiddleware, this.getAuthorProfile.bind(this));
		this.app.getAppServer().delete(`${this.route}/profile/photo`, authMiddleware,this.deleteProfilePhoto.bind(this));
	}

	private async getProfile(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const userId = req.userId;
			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			const [user, profile] = await Promise.all([
				this.userModel
				.findById(userId)
				.select('-password')
				.populate({
					path: 'careers',
					select: 'name facultyId',
					populate: { path: 'facultyId', select: 'name' },
				})
				.exec(),
				this.profileModel.findOne({ user: userId }).exec(),
			]);


			if (!user) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Usuario no encontrado' });
			}

			const mergedProfile = {
				_id: user._id,
				username: user.username,
				apellidoPaterno: user.apellidoPaterno ?? '',
				apellidoMaterno: user.apellidoMaterno ?? '',
				email: user.email,
				careers: Array.isArray(user.careers)
					? (user.careers as any[]).map((c) => ({
						_id: c._id,
						name: c.name,
						faculty: c.facultyId
							? { _id: c.facultyId._id, name: c.facultyId.name }
							: undefined,
					}))
						: [],
						bio: profile?.bio ?? '',
						interests: profile?.interests ?? [],
						profilePicture: profile?.profilePicture ?? '',
			};

			return res.status(StatusCodes.OK).json({ profile: mergedProfile });
		} catch (error) {
			console.error('Error al obtener el perfil:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener el perfil', error });
		}
	}


	private async updateProfile(req: AuthRequest, res: Response): Promise<void> {
		try {
			const userId = req.userId;

			if (!userId) {
				res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
				return;
			}

			const { bio, interests } = req.body;
			const profilePicture = req.file?.filename; // Nombre del archivo subido

			let profile = await this.profileModel.findOne({ user: userId }).exec();
			if (!profile) profile = new this.profileModel({ user: userId });

			if (typeof bio === 'string') {
				profile.bio = bio;
			}

			if (typeof interests !== 'undefined') {
				// interests puede venir como JSON string o como texto con comas
				let parsed: string[] = [];
				if (Array.isArray(interests)) {
					parsed = interests.map((i: any) => String(i).trim()).filter(Boolean);
				} else if (typeof interests === 'string' && interests.trim().length > 0) {
					// intenta parsear JSON ["a","b"] o cae a split por coma
					try {
						const maybe = JSON.parse(interests);
						if (Array.isArray(maybe)) {
							parsed = maybe.map((i: any) => String(i).trim()).filter(Boolean);
						} else {
							parsed = interests.split(',').map(s => s.trim()).filter(Boolean);
						}
					} catch {
						parsed = interests.split(',').map(s => s.trim()).filter(Boolean);
					}
				} else if (typeof interests === 'string' && interests.trim().length === 0) {
					// si envías string vacío explícitamente, interpretamos como limpiar intereses
					parsed = [];
				}
				profile.interests = parsed;
			}

			if (profilePicture) {
				profile.profilePicture = `uploads/${profilePicture}`; // Guarda ruta relativa
			}

			profile.updated_at = new Date();
			await profile.save();

			res.status(StatusCodes.OK).json({ profile });
		} catch (error) {
			console.error('Error al actualizar el perfil:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar el perfil', error });
		}
	}

	private async getAuthorProfile(req: AuthRequest, res: Response): Promise<Response> {
		try {
			const { id } = req.params;
			const userId = req.userId;

			if (!userId) {
				return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
			}

			const userObjectId = new Types.ObjectId(userId);

			const author = await this.userModel
			.findById(id)
			.select('-password')
			.populate({
				path: 'careers',
				select: 'name facultyId',
				populate: { path: 'facultyId', select: 'name' },
			})
			.exec();

			const profile = await this.profileModel.findOne({ user: id }).exec();

			if (!author) {
				return res.status(StatusCodes.NOT_FOUND).json({ message: 'Autor no encontrado' });
			}

			const currentUser = await this.userModel.findById(userId).exec();

			const isFriend = author.friends?.some((f: Types.ObjectId) => f.equals(userObjectId)) ?? false;
			const hasSentRequest = author.friendRequests?.some((r: Types.ObjectId) => r.equals(userObjectId)) ?? false;
			const hasReceivedRequest = currentUser?.friendRequests?.some((r: Types.ObjectId) => r.equals(author._id)) ?? false;

			const authorProfile = {
				_id: author._id,
				username: author.username,
				apellidoPaterno: author.apellidoPaterno ?? '',
				apellidoMaterno: author.apellidoMaterno ?? '',
				email: author.email, // el frontend ya no lo muestra para terceros
				careers: Array.isArray(author.careers)
					? (author.careers as any[]).map((c) => ({
						_id: c._id,
						name: c.name,
						faculty: c.facultyId
							? { _id: c.facultyId._id, name: c.facultyId.name }
							: undefined,
					}))
						: [],
						bio: profile?.bio ?? '',
						interests: profile?.interests ?? [],
						profilePicture: profile?.profilePicture ?? '',
						isFriend,
						hasSentRequest,
						hasReceivedRequest,
			};

			return res.status(StatusCodes.OK).json({ author: authorProfile });
		} catch (error) {
			console.error('Error al obtener el perfil del autor:', error);
			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener el perfil del autor', error });
		}
	}
	private async deleteProfilePhoto(req: AuthRequest, res: Response): Promise<void> {
		try {
			const userId = req.userId;
			if (!userId) {
				res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Usuario no autenticado' });
				return;
			}

			const profile = await this.profileModel.findOne({ user: userId }).exec();
			if (!profile) {
				res.status(StatusCodes.NOT_FOUND).json({ message: 'Perfil no encontrado' });
				return;
			}

			if (profile.profilePicture) {
				const uploadsDir = path.resolve(process.cwd(), 'uploads');
				const absolute = path.resolve(process.cwd(), profile.profilePicture); // p.ej. 'uploads/abc.jpg'
				if (absolute.startsWith(uploadsDir)) {
					try { await fs.unlink(absolute); } catch { /* ignore missing */ }
				}
				profile.profilePicture = undefined;
				profile.updated_at = new Date();
				await profile.save();
			}

			res.status(StatusCodes.OK).json({ profile });
		} catch (error) {
			console.error('Error al eliminar foto de perfil:', error);
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar la foto', error });
		}
	}

}

