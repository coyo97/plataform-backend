import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";

export interface ILearningReview extends Document {
	user: Types.ObjectId;
	quizItemId: Types.ObjectId;
	subjectId: Types.ObjectId;
	topicId?: Types.ObjectId;

	repetition: number;     // cuántas veces pasó
	intervalDays: number;   // intervalo actual
	easeFactor: number;     // factor de facilidad
	dueDate: Date;          // próxima fecha de repaso
	lastReviewedAt?: Date;

	created_at: Date;
	updated_at: Date;
}

const LearningReviewSchema = new Schema<ILearningReview>({
	user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
	quizItemId: { type: Schema.Types.ObjectId, ref: "LearningQuizItem", required: true, unique: true, index: true },
	subjectId: { type: Schema.Types.ObjectId, ref: "LearningSubject", required: true, index: true },
	topicId: { type: Schema.Types.ObjectId, ref: "LearningTopic", index: true },

	repetition: { type: Number, default: 0 },
	intervalDays: { type: Number, default: 0 },
	easeFactor: { type: Number, default: 2.5 },
	dueDate: { type: Date, default: Date.now, index: true },
	lastReviewedAt: { type: Date },

	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

LearningReviewSchema.index({ user: 1, dueDate: 1 });

export const LearningReviewModel = (mongoose: Mongoose) =>
	mongoose.model<ILearningReview>("LearningReview", LearningReviewSchema);
