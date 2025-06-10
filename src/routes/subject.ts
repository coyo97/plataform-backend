import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { SubjectModel } from './schemas/subject';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

export class SubjectController {
	private route:string; private app:App; private model:ReturnType<typeof SubjectModel>;
	constructor(app:App, prefix:string){
		this.route = `${prefix}/subjects`;
		this.app = app;
		this.model = SubjectModel(this.app.getClientMongoose());
		this.init();
	}
	private init(){
		const s=this.app.getAppServer();
		s.post (this.route,          authMiddleware, this.create.bind(this));
		s.get  (this.route,                          this.list.bind(this));
		s.put  (`${this.route}/:id`, authMiddleware, this.update.bind(this));
		s.delete(`${this.route}/:id`,authMiddleware, this.remove.bind(this));
	}
	private async create(req:Request,res:Response){
		try{
			const subject = await this.model.create(req.body);
			res.status(StatusCodes.CREATED).json({subject});
		}catch(e){
			res.status(StatusCodes.BAD_REQUEST).json({message:'Error',e});
		}
	}
	private async list(req:Request,res:Response){
		const { careerId } = req.query;
		const q:any = careerId ? { careerIds: careerId } : {};
		const subjects = await this.model.find(q).sort({ code:1 }).exec();
		res.status(StatusCodes.OK).json({subjects});
	}
	private async update(req:Request,res:Response){
		const subject = await this.model.findByIdAndUpdate(req.params.id,req.body,{new:true});
		res.status(StatusCodes.OK).json({subject});
	}
	private async remove(req:Request,res:Response){
		await this.model.findByIdAndDelete(req.params.id);
		res.status(StatusCodes.OK).json({message:'Eliminado'});
	}
}

