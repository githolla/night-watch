import type { SupabaseClient } from '@supabase/supabase-js';
type Row=Record<string,unknown>;
export function memoryDb(seed:Record<string,Row[]>={}){
 const tables=structuredClone(seed);let tick=0;
 const failures:Array<{table:string;op:string}> = [];
 function from(table:string){
  let op='select',payload:Row|Row[]={},single=false,head=false,count=false,ignore=false,max=Infinity;
  const filters:Array<(r:Row)=>boolean>=[];
  const q={
   select(_columns?:string,opts?:{head?:boolean;count?:string}){head=!!opts?.head;count=!!opts?.count;return q},
   insert(value:Row|Row[]){op='insert';payload=value;return q},
   upsert(value:Row|Row[],opts?:{ignoreDuplicates?:boolean}){op='insert';payload=value;ignore=!!opts?.ignoreDuplicates;return q},
   update(value:Row){op='update';payload=value;return q},
   eq(key:string,value:unknown){filters.push(r=>r[key]===value);return q},
   neq(key:string,value:unknown){filters.push(r=>r[key]!==value);return q},
   in(key:string,value:unknown[]){filters.push(r=>value.includes(r[key]));return q},
   is(key:string,value:unknown){filters.push(r=>(r[key]??null)===value);return q},
   lte(key:string,value:string){filters.push(r=>String(r[key])<=value);return q},
   not(key:string,operator:string,value:unknown){filters.push(r=>operator==='is'?(r[key]??null)!==value:r[key]!==value);return q},
   limit(n:number){max=n;return q},
   single(){single=true;return q},maybeSingle(){single=true;return q},
   then(resolve:(r:{data:Row[]|Row|null;error:{code:string;message:string}|null;count?:number})=>unknown){
    const f=failures.findIndex(f=>f.table===table&&f.op===op);
    if(f>=0){failures.splice(f,1);return Promise.resolve(resolve({data:null,error:{code:'FAIL',message:'Injected failure'}}));}
    const rows=tables[table]??(tables[table]=[]);let result=rows.filter(r=>filters.every(fn=>fn(r))).slice(0,max);
    if(op==='insert'){
     result=[];
     for(const value of Array.isArray(payload)?payload:[payload]){
      const duplicate=rows.some(r=>(value.id&&r.id===value.id)||(table==='cadences'&&r.card_id===value.card_id)||(table==='cadence_steps'&&r.cadence_id===value.cadence_id&&r.step_number===value.step_number));
      if(duplicate){if(ignore)continue;return Promise.resolve(resolve({data:null,error:{code:'23505',message:'Duplicate'}}));}
      const row={id:`row-${++tick}`,updated_at:`revision-${tick}`,...value};rows.push(row);result.push(row);
     }
    }else if(op==='update'){for(const row of result)Object.assign(row,payload,{updated_at:`revision-${++tick}`});}
    return Promise.resolve(resolve({data:head?null:structuredClone(single?result[0]??null:result),error:null,...(count?{count:result.length}:{})}));
   }
  };return q;
 }
 return {db:{from} as unknown as SupabaseClient,tables,fail:(table:string,op:string)=>failures.push({table,op})};
}
