// src/routes/schemas/role.ts
import { Schema, model, Document } from 'mongoose';
import { IPermission } from './permission';

export interface IRole extends Document {
  name: string;
  description?: string;
  permissions: IPermission['_id'][];
}

const roleSchema = new Schema<IRole>({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  permissions: [{ type: Schema.Types.ObjectId, ref: 'Permission' }],
});

export const RoleModel = (mongoose: typeof import('mongoose')) =>
  mongoose.model<IRole>('Role', roleSchema);

