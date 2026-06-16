import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";

export interface ILearningChunk extends Document {
	user: Types.ObjectId;
	documentId: Types.ObjectId;
	subjectId: Types.ObjectId;
	topicId?: Types.ObjectId;

	idx: number;
	text: string;
	charStart: number;
	charEnd: number;

	created_at: Date;
	updated_at: Date;
}

const LearningChunkSchema = new Schema<ILearningChunk>({
	user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
	documentId: { type: Schema.Types.ObjectId, ref: "LearningDocument", required: true, index: true },
	subjectId: { type: Schema.Types.ObjectId, ref: "LearningSubject", required: true, index: true },
	topicId: { type: Schema.Types.ObjectId, ref: "LearningTopic", index: true },

	idx: { type: Number, required: true },
	text: { type: String, required: true },

	charStart: { type: Number, required: true },
	charEnd: { type: Number, required: true },

	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

LearningChunkSchema.index({ documentId: 1, idx: 1 }, { unique: true });

export const LearningChunkModel = (mongoose: Mongoose) =>
	mongoose.model<ILearningChunk>("LearningChunk", LearningChunkSchema);
