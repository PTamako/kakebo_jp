import {approvedPointsRoute} from './points-execution.js';
export async function onRequest({request,env,params}){
 return approvedPointsRoute(request,env,params.path||[]);
}
