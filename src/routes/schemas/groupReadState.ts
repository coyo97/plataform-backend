// src/routes/schemas/groupReadState.ts
import mongoose, { Schema, Document, Mongoose, Types } from 'mongoose';

export interface IGroupReadState extends Document {
	groupId: Types.ObjectId;
	userId: Types.ObjectId;
	lastReadAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

const groupReadStateSchema: Schema<IGroupReadState> = new Schema(
	{
		groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
		userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
		lastReadAt: {
			type: Date,
			required: true,
			// si nunca leyó, lo dejamos en epoch
			default: () => new Date(0),
		},
	},
	{
		timestamps: true,
		collection: 'groupreads', // nombre explícito para la colección
	},
);

// Un usuario solo tiene un estado de lectura por grupo
groupReadStateSchema.index({ groupId: 1, userId: 1 }, { unique: true });

export const GroupReadStateModel = (mongooseInstance: Mongoose) => {
	return mongooseInstance.model<IGroupReadState>(
		'GroupReadState',
		groupReadStateSchema,
	);
};

