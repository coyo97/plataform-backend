// src/routes/fileFormatController.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FileFormatModel } from './schemas/fileFormat';
import App from '../app';
import { authMiddleware, adminMiddleware } from '../middlware/authMiddlewares';

interface AuthRequest extends Request {
  userId?: string;
}

export class FileFormatController {
  private route: string;
  private app: App;
  private fileFormatModel: ReturnType<typeof FileFormatModel>;

  constructor(app: App, route: string) {
    this.route = route;
    this.app = app;
    this.fileFormatModel = FileFormatModel(this.app.getClientMongoose());
    this.initRoutes();
  }

  private initRoutes(): void {
    // Ruta para obtener todos los formatos
    this.app.getAppServer().get(
      `${this.route}/file-formats`,
      authMiddleware,
      this.getFileFormats.bind(this)
    );

    // Ruta para crear un nuevo formato
    this.app.getAppServer().post(
      `${this.route}/file-formats`,
      authMiddleware,
      this.createFileFormat.bind(this)
    );

    // Ruta para actualizar un formato
    this.app.getAppServer().put(
      `${this.route}/file-formats/:id`,
      authMiddleware,
      this.updateFileFormat.bind(this)
    );

    // Ruta para eliminar un formato
    this.app.getAppServer().delete(
      `${this.route}/file-formats/:id`,
      authMiddleware,
      this.deleteFileFormat.bind(this)
    );
  }

  // Método para obtener todos los formatos
  private async getFileFormats(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const formats = await this.fileFormatModel.find().exec();
      return res.status(StatusCodes.OK).json({ formats });
    } catch (error) {
      console.error('Error al obtener los formatos de archivo:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al obtener los formatos de archivo', error });
    }
  }

  // Método para crear un nuevo formato
  private async createFileFormat(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const { mimeType, description } = req.body;

      if (!mimeType) {
        return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El campo mimeType es obligatorio' });
      }

      const existingFormat = await this.fileFormatModel.findOne({ mimeType }).exec();
      if (existingFormat) {
        return res.status(StatusCodes.CONFLICT).json({ message: 'El formato ya existe' });
      }

      const newFormat = new this.fileFormatModel({
        mimeType,
        description,
        enabled: true,
      });

      await newFormat.save();
      return res.status(StatusCodes.CREATED).json({ format: newFormat });
    } catch (error) {
      console.error('Error al crear el formato de archivo:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al crear el formato de archivo', error });
    }
  }

  // Método para actualizar un formato
  private async updateFileFormat(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { mimeType, description, enabled } = req.body;

      const format = await this.fileFormatModel.findById(id).exec();
      if (!format) {
        return res.status(StatusCodes.NOT_FOUND).json({ message: 'Formato no encontrado' });
      }

      if (mimeType) format.mimeType = mimeType;
      if (description) format.description = description;
      if (typeof enabled === 'boolean') format.enabled = enabled;

      await format.save();
      return res.status(StatusCodes.OK).json({ format });
    } catch (error) {
      console.error('Error al actualizar el formato de archivo:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al actualizar el formato de archivo', error });
    }
  }

  // Método para eliminar un formato
  private async deleteFileFormat(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params;

      const format = await this.fileFormatModel.findByIdAndDelete(id).exec();
      if (!format) {
        return res.status(StatusCodes.NOT_FOUND).json({ message: 'Formato no encontrado' });
      }

      return res.status(StatusCodes.OK).json({ message: 'Formato eliminado correctamente' });
    } catch (error) {
      console.error('Error al eliminar el formato de archivo:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Error al eliminar el formato de archivo', error });
    }
  }
}

