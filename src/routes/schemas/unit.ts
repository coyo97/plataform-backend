// schemas/unit.ts
import { Schema, Mongoose, Document } from 'mongoose';

export interface IUnit extends Document {
	subjectId: Schema.Types.ObjectId;
	title    : string;
	week?    : number;
}

const unitSchema = new Schema<IUnit>({
	subjectId: { type:Schema.Types.ObjectId, ref:'Subject', required:true },
	title    : { type:String, required:true },
	week     : { type:Number }
});

export const UnitModel = (mongoose:Mongoose) =>
	mongoose.model<IUnit>('Unit', unitSchema);

