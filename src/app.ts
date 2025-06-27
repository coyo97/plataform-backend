// src/app.ts
import express, { Express } from 'express';
import { parseEnvBoolean, parseEnvNumber, parseEnvString } from './utils';
import { UserController } from './routes/users';
import { RoleController } from './routes/roles';
import { maxUploadSize } from './middlware/upload';

import path from 'path';
import * as dotenv from 'dotenv';
import mongoose, { Mongoose } from 'mongoose';
import cors from 'cors';
import { PublicationController } from './routes/publications';
import { ProfileController } from './routes/profile';
import { CommentController } from './routes/comments';
import { CareerController } from './routes/career';

import SocketController from './routes/socket';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import MessageController from './routes/message';
import GroupController from './routes/group';
import StreamController from './routes/stream';
import { NotificationController } from './routes/notifications';
import { FileFormatController } from './routes/fileFormatController';
import { SettingsController } from './routes/settingsController';
import { ReportController } from './routes/reportController';
import { AcademicHelpController } from './routes/academicHelp';
import { HelpThreadController } from './routes/helpThread';
import { PermissionsController } from './routes/permissionsController';
import { FacultyController } from './routes/faculty';
import { CycleController   } from './routes/cycle';
import { SubjectController } from './routes/subject';
import { UnitController    } from './routes/unit';
import { ResourceController } from './routes/resource';

if (process.env.NODE_ENV !== 'production') {
	dotenv.config();
}

export default class App {
	private appServer: Express;
	private port: number = parseEnvNumber('PORT');
	private apiVersion: string = parseEnvString('API_VERSION');
	private apiPrefix: string = parseEnvString('API_PREFIX');
	private databasePort: number = parseEnvNumber('DATABASE_PORT');
	private databaseHost: string = parseEnvString('DATABASE_HOST');
	private databaseUser: string = parseEnvString('DATABASE_USER');
	private databasePassword: string = parseEnvString('DATABASE_PASSWORD');
	private databaseName: string = parseEnvString('DATABASE_NAME');
	private databaseClient: Mongoose;

	private httpServer: HttpServer; // Servidor HTTP
	private io: SocketIOServer; // Servidor Socket.IO
	private useCors: boolean = parseEnvBoolean('USE_CORS');

	private socketController: SocketController;

	constructor() {
		this.databaseClient = mongoose;
		this.appServer = express();

		// Inicializa el servidor HTTP y Socket.IO
		this.httpServer = createServer(this.appServer);
		this.io = new SocketIOServer(this.httpServer, {
			cors: {
				origin: '*', // Configura esto según tus necesidades
				methods: ['GET', 'POST'],
			},
		});
		this.socketController = new SocketController(this.io, this);
		this.setupServer();
	}

	private setupServer(): void {
		console.log(`App is running at http://localhost:${this.port}`);
			this.appServer.use(cors());
		this.appServer.use(express.json());
		this.appServer.use(express.urlencoded({ extended: true })); // Para habilitar el ruteo
		// Configuración para servir archivos estáticos desde la carpeta 'uploads'
		this.appServer.use('/uploads', express.static(path.join(__dirname, '../uploads')));

		this.setupMiddlewares();
		this.configureSockets(); // Mover la inicialización del SocketController aquí

		this.setupDatabase();
		this.initRoutes('users');
	}

	private initRoutes(service: string): void {
		const userController = new UserController(this, `/${this.apiVersion}/${this.apiPrefix}/${service}`, this.socketController);
		userController.initLoginRoute();
		new RoleController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new PublicationController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new ProfileController(this, `/${this.apiVersion}/${this.apiPrefix}`);

		new CommentController(this, `/${this.apiVersion}/${this.apiPrefix}`, this.socketController);
		new CareerController(this, `/${this.apiVersion}/${this.apiPrefix}`);

		// Pasar socketController a MessageController y NotificationController
		new MessageController(this, `/${this.apiVersion}/${this.apiPrefix}`,  this.socketController);
		new GroupController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new StreamController( this, `/${this.apiVersion}/${this.apiPrefix}`, this.socketController);
		new NotificationController(this, `/${this.apiVersion}/${this.apiPrefix}`,  this.socketController);
		new FileFormatController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new SettingsController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new ReportController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new PermissionsController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new AcademicHelpController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new HelpThreadController(this, `/${this.apiVersion}/${this.apiPrefix}`, this.socketController);
		new FacultyController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new CycleController  (this, `/${this.apiVersion}/${this.apiPrefix}`);
		new SubjectController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new UnitController   (this, `/${this.apiVersion}/${this.apiPrefix}`);
		new ResourceController(this, `/${this.apiVersion}/${this.apiPrefix}`);

	}

	private async setupDatabase() {
	///const connectionString = `mongodb://${this.databaseUser}:${this.databasePassword}@${this.databaseHost}:${this.databasePort}/${this.databaseName}`;
	const connectionString = `mongodb+srv://${this.databaseUser}:${this.databasePassword}@${this.databaseHost}/${this.databaseName}?retryWrites=true&w=majority&appName=Cluster0`;

			console.log('connection', connectionString);
		try {
			await mongoose.connect(connectionString);
			console.log('Database connected successfully');
			console.log('Conectado a:', mongoose.connection.host);
		} catch (error) {
			console.error('Error connecting to database:', error);
		}
	}

	public getAppServer(): Express {
		return this.appServer;
	}

	public getPort(): number {
		return this.port;
	}

	public getClientMongoose(): Mongoose {
		return this.databaseClient;
	}

	private setupMiddlewares(): void {
		this.appServer.use(express.json());
		if (this.useCors) {
			this.appServer.use(cors());
		}
		// Otros middlewares...
	}

	private configureSockets(): void {
		// Inicializar SocketController una sola vez
		this.socketController = new SocketController(this.io, this);
	}

	public getHttpServer(): HttpServer {
		return this.httpServer;
	}
}

