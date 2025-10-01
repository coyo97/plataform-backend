import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";
import { IRole } from "./role";
import { ICareer } from "./career"; // Importa el modelo de carrera

export interface IUser extends Document {
	_id: mongoose.Types.ObjectId;
	username: string; // será tratado como nombre en el frontend
	email: string;
	password: string;
	roles: IRole[];
	careers: ICareer['_id'][]; // Campo para almacenar las carreras seleccionadas
	status: string;
	friends: mongoose.Types.ObjectId[]; // Lista de amigos
	friendRequests: mongoose.Types.ObjectId[]; // Solicitudes de amistad recibidas
	apellidoPaterno?: string;
	apellidoMaterno?: string;

	//para rastrear
	reportCount: number;
	uniqueReporters: Types.ObjectId[];
	blockedUsers: Types.ObjectId[]; // Opción alternativa
	resetPasswordToken?: string;
	resetPasswordExpires?: Date;
}

const userSchema: Schema<IUser> = new Schema({
	username: { type: String, required: true },
	email: { type: String, required: true, unique: true },
	password: { type: String, required: true },
	roles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
	careers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Career' }], // Campo para carreras
	status: { type: String, enum: ['active', 'deactivated', 'blacklisted'], default: 'active' },
	friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Añadido
	friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Añadido

	apellidoPaterno: { type: String, required: false },
	apellidoMaterno: { type: String, required: false },

	//para rastrear usuario y contar sus reportes
	reportCount: { type: Number, default: 0 },
	uniqueReporters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
	blockedUsers: [{ type: mongoose.Types.ObjectId, ref: 'User' }], // Añade esto
	resetPasswordToken: { type: String },
	resetPasswordExpires: { type: Date },
});

userSchema.virtual('profile', {
	ref: 'Profile',
	localField: '_id',
	foreignField: 'user',
	justOne: true,
});

userSchema.set('toObject', { virtuals: true });
userSchema.set('toJSON', { virtuals: true });

export const UserModel = (mongoose: Mongoose) => {
	return mongoose.model<IUser>("User", userSchema);
};

