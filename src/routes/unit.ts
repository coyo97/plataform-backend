import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnitModel } from './schemas/unit';
import App from '../app';
import { authMiddleware } from '../middlware/authMiddlewares';

export class UnitController {
	private route:string; private app:App; private model:ReturnType<typeof UnitModel>;
	constructor(app:App, prefix:string){
		this.route = `${prefix}/units`;
		this.app = app;
		this.model = UnitModel(this.app.getClientMongoose());
		this.init();
	}
	private init(){
		const srv = this.app.getAppServer();
		srv.post (this.route,          authMiddleware, this.create.bind(this));
		srv.get  (this.route,                          this.list.bind(this));
		srv.put  (`${this.route}/:id`, authMiddleware, this.update.bind(this));
		srv.delete(`${this.route}/:id`,authMiddleware, this.remove.bind(this));
	}
	private async create(req:Request,res:Response){
		const unit = await this.model.create(req.body);
		res.status(StatusCodes.CREATED).json({unit});
	}
	private async list(req:Request,res:Response){
		const { subjectId } = req.query;
		const units = await this.model.find(subjectId?{subjectId}:{}).sort({ week:1 }).exec();
		res.status(StatusCodes.OK).json({units});
	}
	private async update(req:Request,res:Response){
		const unit = await this.model.findByIdAndUpdate(req.params.id,req.body,{new:true});
		res.status(StatusCodes.OK).json({unit});
	}
	private async remove(req:Request,res:Response){
		await this.model.findByIdAndDelete(req.params.id);
		res.status(StatusCodes.OK).json({message:'Eliminado'});
	}
}

