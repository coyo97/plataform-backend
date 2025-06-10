import mongoose, { Schema, Document, Mongoose } from 'mongoose';

export interface HelpMessage {
	_id: mongoose.Types.ObjectId;
	author: mongoose.Types.ObjectId;
	content: string;
	attachments?: string[];
	created_at: Date;
	votes: number;
}

export interface IHelpThread extends Document {
	helpId: mongoose.Types.ObjectId; // referencia a AcademicHelp
	messages: HelpMessage[];
	solvedMessage?: mongoose.Types.ObjectId;
}

const helpMessageSchema = new Schema<HelpMessage>({
	author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
	content: { type: String, required: true },
	attachments: [{ type: String }],
	created_at: { type: Date, default: Date.now },
	votes: { type: Number, default: 0 }
});

const helpThreadSchema = new Schema<IHelpThread>({
	helpId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicHelp', required: true, unique: true },
	messages: [helpMessageSchema],
	solvedMessage: { type: mongoose.Schema.Types.ObjectId }
});

export const HelpThreadModel = (mongoose: Mongoose) => {
	return mongoose.model<IHelpThread>('HelpThread', helpThreadSchema);
};

