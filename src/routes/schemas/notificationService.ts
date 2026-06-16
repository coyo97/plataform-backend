// src/routes/services/notificationService.ts
import { Mongoose } from 'mongoose';
import { NotificationModel } from '../schemas/notification';
import SocketController from '../socket';

type CreateNotificationInput = {
	recipients: string[];                 // userIds
	sender: string | undefined;           // req.userId
	type: string;                         // ej. 'report_alert'
	message: string;
	data?: Record<string, any>;
};

export default class NotificationService {
	private notificationModel: ReturnType<typeof NotificationModel>;
	private socket: SocketController;

	constructor(mongoose: Mongoose, socket: SocketController) {
		this.notificationModel = NotificationModel(mongoose);
		this.socket = socket;
	}

	async sendMany(input: CreateNotificationInput) {
		const { recipients, sender, type, message, data } = input;

		if (!recipients.length) return [];
		const notificationsData = recipients.map((recipient) => ({
			recipient,
			sender,
			type,
			message,
			data,
		}));

		const notifications = await this.notificationModel.insertMany(notificationsData);

		// tiempo real
		notifications.forEach((n) => {
			const uid = n.recipient.toString();
			this.socket.emitNotification(uid, n);
		});

		return notifications;
	}
}

