import mongoose, { Schema, Document, Mongoose } from 'mongoose';
import { IUser } from './user';

export interface IProfile extends Document {
	user: IUser['_id'];  // Relaciona el perfil con un usuario
	bio?: string;
	interests?: string[];
	profilePicture?: string;  // Ruta al archivo de imagen del perfil
	created_at: Date;
	updated_at: Date;
}

const profileSchema: Schema<IProfile> = new Schema({
	user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
	bio: { type: String },
	interests: [{ type: String }],
	profilePicture: { type: String },
	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now }
});

export const ProfileModel = (mongoose: Mongoose) => {
	return mongoose.model<IProfile>('Profile', profileSchema);
};

