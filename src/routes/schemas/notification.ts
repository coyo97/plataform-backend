// src/routes/schemas/notification.ts
import mongoose, { Schema, Document, Mongoose } from 'mongoose';
import { IUser } from './user';

export interface INotification extends Document {
  recipient: IUser['_id'];
  sender: IUser['_id'];
  type: string; // Por ejemplo, 'comment', 'like', etc.
  message: string;
  isRead: boolean;
  createdAt: Date;
   data?: any; // Add this line
}

const notificationSchema: Schema<INotification> = new Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
   data: { type: Schema.Types.Mixed }, // Add this line
},
 { timestamps: true }
);

export const NotificationModel = (mongoose: Mongoose) => {
  return mongoose.model<INotification>('Notification', notificationSchema);
};

