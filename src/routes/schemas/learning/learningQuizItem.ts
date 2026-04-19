import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";

export type QuizType = "multiple_choice" | "true_false" | "short_answer";

export interface ILearningQuizItem extends Document {
	user: Types.ObjectId;
	subjectId: Types.ObjectId;
	topicId?: Types.ObjectId;

	question: string;
	type: QuizType;

	options?: string[];
	correctAnswer: string;
	explanation?: string;

	sourceChunkIds: Types.ObjectId[];

	created_at: Date;
	updated_at: Date;
}

const LearningQuizItemSchema = new Schema<ILearningQuizItem>({
	user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
	subjectId: { type: Schema.Types.ObjectId, ref: "LearningSubject", required: true, index: true },
	topicId: { type: Schema.Types.ObjectId, ref: "LearningTopic", index: true },

	question: { type: String, required: true, trim: true },
	type: {
		type: String,
		required: true,
		enum: ["multiple_choice", "true_false", "short_answer"],
		index: true,
	},

	options: [{ type: String }],
	correctAnswer: { type: String, required: true, trim: true },
	explanation: { type: String, trim: true },

	sourceChunkIds: [{ type: Schema.Types.ObjectId, ref: "LearningChunk", required: true }],

	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

LearningQuizItemSchema.index({ user: 1, topicId: 1, created_at: -1 });

export const LearningQuizItemModel = (mongoose: Mongoose) =>
	mongoose.model<ILearningQuizItem>("LearningQuizItem", LearningQuizItemSchema);
