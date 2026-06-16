import mongoose, { Schema, Document, Mongoose } from 'mongoose';
import { IUser } from './user';
import { IPublication } from './publication';

// Interface for comment
export interface IComment extends Document {
    content: string;
    author: IUser['_id'];
    publication: IPublication['_id'];
    created_at: Date;
}

const commentSchema: Schema<IComment> = new Schema({
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    publication: { type: mongoose.Schema.Types.ObjectId, ref: 'Publication', required: true },
    created_at: { type: Date, default: Date.now },
});

export const CommentModel = (mongoose: Mongoose) => {
    return mongoose.model<IComment>('Comment', commentSchema);
};

