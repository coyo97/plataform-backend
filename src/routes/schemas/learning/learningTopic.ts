import mongoose, { Schema, Document, Mongoose, Types } from "mongoose";

export interface ILearningTopic extends Document {
	user: Types.ObjectId;
	subjectId: Types.ObjectId;
	title: string;
	created_at: Date;
	updated_at: Date;
}

const LearningTopicSchema = new Schema<ILearningTopic>({
	user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
	subjectId: { type: Schema.Types.ObjectId, ref: "LearningSubject", required: true, index: true },
	title: { type: String, required: true, trim: true, maxlength: 140 },
	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
});

LearningTopicSchema.index({ user: 1, subjectId: 1, title: 1 }, { unique: true });
LearningTopicSchema.index({ created_at: -1 });

export const LearningTopicModel = (mongoose: Mongoose) =>
	mongoose.model<ILearningTopic>("LearningTopic", LearningTopicSchema);
