import mongoose, { Schema, model, Document, Model } from 'mongoose';

export interface IStream extends Document {
	title: string;
	userId: string;
	streamKey: string;
	active: boolean;
	isScreenSharing: boolean;
	career?: string;
	visibility: 'university' | 'career' | 'private';
	careerIds?: mongoose.Types.ObjectId[];
	accessCode?: string;
	thumbnailUrl?: string;
	viewerCount?: number;
	scheduledAt?: Date;
	endedAt?: Date;
	recordingUrl?: string;
	tags?: string[];
	description?: string;
	likes: mongoose.Types.ObjectId[];
	chatId?: mongoose.Types.ObjectId;
}

const StreamSchema: Schema = new Schema({
	title:           { type: String, required: true },
	userId:          { type: String, required: true },
	streamKey:       { type: String, required: true },
	active:          { type: Boolean, default: true },
	isScreenSharing: { type: Boolean, default: false },
	visibility:      { type: String, enum: ['university', 'career', 'private'], required: true },
	careerIds:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Career' }],
	accessCode:      { type: String },

	// Nuevos campos
	thumbnailUrl:    { type: String },
	viewerCount:     { type: Number, default: 0 },
	scheduledAt:     { type: Date },
	endedAt:         { type: Date },
	recordingUrl:    { type: String },
	tags:            [{ type: String }],
	description:     { type: String },
	likes: {type: [mongoose.Schema.Types.ObjectId],ref: 'User',default: [],},
	chatId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
}, { timestamps: true });

export const StreamModel: Model<IStream> = model<IStream>('Stream', StreamSchema);

