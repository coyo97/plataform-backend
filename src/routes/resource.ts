// src/routes/resource.ts
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ResourceModel } from './schemas/resource';
import { getUploadMiddleware } from '../middlware/upload';
import { authMiddleware } from '../middlware/authMiddlewares';
import App from '../app';

export class ResourceController {
	private route:string; 
	private app:App; 
	private model:ReturnType<typeof ResourceModel>;
	constructor(app:App, prefix:string){
		this.route = `${prefix}/resources`;
		this.app   = app;
		this.model = ResourceModel(this.app.getClientMongoose());
		this.init();
	}
	private init(){
		const up = getUploadMiddleware(30*1024*1024);      // 30 MB
		const s = this.app.getAppServer();
		s.post (this.route,          authMiddleware, up.single('file'), this.create.bind(this));
		s.get  (this.route,                              this.list.bind(this));
		s.get  (`${this.route}/:id`,                     this.getOne.bind(this));
		s.put  (`${this.route}/:id`, authMiddleware,      this.update.bind(this));
		s.delete(`${this.route}/:id`,authMiddleware,      this.remove.bind(this));
	}
	private async create(req:Request,res:Response){
		try{
			const { kind, subjectId, cycleId, title } = req.body;
			const filePath = `uploads/${req.file?.filename}`;
			const resource = await this.model.create({
				kind, subjectId, cycleId, title,
				filePath, uploader:(req as any).userId
			});
			res.status(StatusCodes.CREATED).json({resource});
		}catch(e){ res.status(StatusCodes.BAD_REQUEST).json({message:'Error',e}); }
	}
	private async list(req:Request,res:Response){
		const { kind, subjectId, cycleId } = req.query;
		const q:any = {};
		if(kind) q.kind = kind;
		if(subjectId) q.subjectId = subjectId;
		if(cycleId) q.cycleId = cycleId;
		const resources = await this.model.find(q)
		.populate('subjectId cycleId uploader','name code year username')
		.sort({ created_at:-1 }).exec();
		res.status(StatusCodes.OK).json({resources});
	}
	private async getOne(req:Request,res:Response){
		const r = await this.model.findById(req.params.id)
		.populate('subjectId cycleId uploader','name code year username');
		res.status(StatusCodes.OK).json({resource:r});
	}
	private async update(req:Request,res:Response){
		const r = await this.model.findByIdAndUpdate(req.params.id,req.body,{new:true});
		res.status(StatusCodes.OK).json({resource:r});
	}
	private async remove(req:Request,res:Response){
		await this.model.findByIdAndDelete(req.params.id);
		res.status(StatusCodes.OK).json({message:'Eliminado'});
	}
}

