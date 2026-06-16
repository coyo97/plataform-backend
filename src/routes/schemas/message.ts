// src/routes/schemas/message.ts
import mongoose, { Schema, Document, Mongoose, Types } from 'mongoose';
import { IUser } from './user';

export interface IMessage extends Document {
	sender: Types.ObjectId | IUser;
	receiver?: Types.ObjectId | IUser | null;
	content: string;
	createdAt: Date;
	isGroupMessage: boolean;
	groupId?: string;
	isRead: boolean;
	filePath?: string; // Agregar este campo
	fileType?: string; // Agregar este campo
}

const messageSchema: Schema<IMessage> = new Schema(
	{
		sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
		receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		content: { type: String },
		createdAt: { type: Date, default: Date.now },
		isGroupMessage: { type: Boolean, default: false },
		groupId: { type: String },
		isRead: { type: Boolean, default: false },
		filePath: { type: String }, // Campo para la ruta del archivo
		fileType: { type: String }, // Campo para el tipo MIME del archivo
	},
);

export const MessageModel = (mongoose: Mongoose) => {
	return mongoose.model<IMessage>('Message', messageSchema);
};

