// schemas/resource.ts
import { Schema, Mongoose, Document } from 'mongoose';

export interface IResource extends Document {
	kind     : 'notes' | 'exam' | 'assignment' | 'other';
	subjectId: Schema.Types.ObjectId;
	cycleId  : Schema.Types.ObjectId;
	filePath : string;
	version  : number;         // 1,2,3...
	title    : string;
	uploader : Schema.Types.ObjectId; // User
	created_at:Date;
}

const resourceSchema = new Schema<IResource>({
	kind     : { type:String, enum:['notes','exam','assignment','other'], required:true },
	subjectId: { type:Schema.Types.ObjectId, ref:'Subject', required:true },
	cycleId  : { type:Schema.Types.ObjectId, ref:'Cycle', required:true },
	filePath : { type:String, required:true },
	version  : { type:Number, default:1 },
	title    : { type:String, required:true },
	uploader : { type:Schema.Types.ObjectId, ref:'User', required:true },
	created_at: { type:Date, default:Date.now }
});

export const ResourceModel = (mongoose:Mongoose) =>
	mongoose.model<IResource>('Resource', resourceSchema);

