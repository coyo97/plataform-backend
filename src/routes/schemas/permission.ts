// src/routes/schemas/permission.ts
import { Schema, Document, model } from 'mongoose';
import { IModule } from './module';
import { IAction } from './action';

export interface IPermission extends Document {
  module: IModule['_id'];
  action: IAction['_id'];
  name: string;
  description?: string;
}

const PermissionSchema = new Schema<IPermission>({
  module: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
  action: { type: Schema.Types.ObjectId, ref: 'Action', required: true },
  name: { type: String, required: true, unique: true },
  description: { type: String },
});

export const PermissionModel = (mongoose: typeof import('mongoose')) =>
  mongoose.model<IPermission>('Permission', PermissionSchema);

