// schemas/faculty.ts
import { Schema, Mongoose, Document } from 'mongoose';

export interface IFaculty extends Document {
	name: string;
	dean?: string;
	icon?: string;          // ruta a PNG / SVG
}

const facultySchema = new Schema<IFaculty>({
	name : { type:String, required:true, unique:true },
	dean : { type:String },
	icon : { type:String }
});

export const FacultyModel = (mongoose:Mongoose) =>
	mongoose.model<IFaculty>('Faculty', facultySchema);

