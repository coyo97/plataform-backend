import express, { Express } from "express";
import {parseEnvBoolean, parseEnvNumber, parseEnvString} from "./utils";
import { UserController } from "./routes/users";
import { RoleController } from "./routes/roles"; // Importa el controlador de roles si es necesario
import { upload } from "./middlware/upload";
import path from 'path';
import * as dotenv from "dotenv";
import  mongoose, {Mongoose, connection} from 'mongoose';
import cors from 'cors';
import {PublicationController} from "./routes/publications";
import { ProfileController } from "./routes/profile";
import { CommentController } from "./routes/comments";
import { CareerController } from "./routes/career";

import SocketController from "./routes/socket";
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import MessageController from "./routes/message";
import GroupController from "./routes/group";

if (process.env.NODE_ENV !== "production") {
	dotenv.config();
}
export default class App {
	private appServer: Express;
	private port: number = parseEnvNumber('PORT' || '');
	private apiVersion: string = parseEnvString('API_VERSION' || '');
	private apiPrefix: string = parseEnvString('API_PREFIX' || '');
	private databasePort:number = parseEnvNumber('DATABASE_PORT' || '');
	private databaseHost: string = parseEnvString('DATABASE_HOST' || '');
	private databaseUser: string = parseEnvString('DATABASE_USER' || '');
	private databasePassword: string = parseEnvString('DATABASE_PASSWORD' || '');
	private databaseName: string = parseEnvString('DATABASE_NAME' || '');
	private databaseClient: Mongoose;

	private httpServer: HttpServer; // Servidor HTTP
	private io: SocketIOServer;      // Servidor Socket.IO
	private useCors: boolean = parseEnvBoolean('USE_CORS' || '');

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

		this.setupServer();
	}
	private setupServer(): void{
		console.log(`App is running at http://localhost:${this.port}`);
		this.appServer.use(cors());
		this.appServer.use(express.json());
		this.appServer.use(express.urlencoded({extended: true}));//para habilitar el ruteo
		// Configuración para servir archivos estáticos desde la carpeta 'uploads'
		this.appServer.use('/uploads', express.static(path.join(__dirname, '../uploads')));

		this.setupMiddlewares();
		this.configureSockets();

		this.setupDatabase();
		this.initRoutes('users')

	}
	private initRoutes(service: string): void {
		//this.appServer.use(`${this.apiPrefix}/${this.apiVersion}/${service}`, userRoute);//creando ruta
		const userController = new UserController(this, `/${this.apiVersion}/${this.apiPrefix}/${service}`);
		userController.initLoginRoute();
        new RoleController(this, `/${this.apiVersion}/${this.apiPrefix}`); // Instanc
		new PublicationController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new ProfileController(this, `/${this.apiVersion}/${this.apiPrefix}`);

		new CommentController(this, `/${this.apiVersion}/${this.apiPrefix}`);
		new CareerController(this, `/${this.apiVersion}/${this.apiPrefix}`);

		new MessageController(this, `/${this.apiVersion}/${this.apiPrefix}`, this.io);
		new GroupController(this, `/${this.apiVersion}/${this.apiPrefix}`);
	}
	private async setupDatabase() {
		const connectionString = `mongodb://${this.databaseUser}:${this.databasePassword}@${this.databaseHost}:${this.databasePort}/${this.databaseName}`;
			console.log('connection', connectionString);
			const connected = await mongoose.connect(connectionString);
		if(connected) {
			console.log('Database connected successfully');
		}
		this.databaseClient.connect(connectionString);

		this.databaseClient.connection.on("error", (error) => {
			console.log(error);
		});

		this.databaseClient.connection.once("open", () => {
			console.log("Connected to database");
		});
	}
	public getAppServer(): Express {
		return this.appServer;
	}
	public getPort():number {
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
		new SocketController(this.io);
	}
	public getHttpServer(): HttpServer {
		return this.httpServer;
	}
}
