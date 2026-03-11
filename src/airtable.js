const Airtable=require('airtable');
const{DateTime}=require('luxon');

function isoNow(){return DateTime.now().toUTC().toISO();}
function runKeyUTC(nowUTC){return `${nowUTC.toFormat('yyyy-LL-dd_HH')}:00`;}
function escapeFormulaString(value){return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');}
const TABLES=Object.freeze({posts:'Posts',jobs:'Jobs',published:'Published'});

class AirtableClient{
 constructor(){
  const apiKey=process.env.AIRTABLE_TOKEN;
  const baseId=process.env.AIRTABLE_BASE_ID;
  if(!apiKey||!baseId) throw new Error('Missing Airtable credentials');
  this.base=new Airtable({apiKey}).base(baseId);
 }
 async findJobByRunKey(runKey){
  const filterByFormula=`{RunKey} = "${runKey}"`;
  const records=await this.base(TABLES.jobs).select({filterByFormula,maxRecords:1}).firstPage();
  return records[0]||null;
 }
 async listEligiblePosts(cutoffISO,opts={}){
  const requireX=opts.requireX!==false;
  const requireThreads=opts.requireThreads!==false;
  const clauses=['{Status} = "Active"'];

  if(requireX){
   clauses.push('FIND("X", ARRAYJOIN({Platforms})) > 0');
   clauses.push(`OR({LastPostedOnXTime} = "", {LastPostedOnXTime} <= DATETIME_PARSE("${cutoffISO}"))`);
  }
  if(requireThreads){
   clauses.push('FIND("Threads", ARRAYJOIN({Platforms})) > 0');
   clauses.push(`OR({LastPostedOnThreadsTime} = "", {LastPostedOnThreadsTime} <= DATETIME_PARSE("${cutoffISO}"))`);
  }

  const filterByFormula=`AND(
    ${clauses.join(",\n    ")}
  )`;
  return await this.base(TABLES.posts).select({filterByFormula}).all();
 }
 async findPostByIdentifier(identifier){
  const raw=String(identifier||'').trim();
  if(!raw) return null;

  const escaped=escapeFormulaString(raw);
  let filterByFormula=`RECORD_ID() = "${escaped}"`;
  if(/^\d+$/.test(raw)){
   filterByFormula=`OR(${filterByFormula}, {Id} = ${Number(raw)})`;
  }

  const records=await this.base(TABLES.posts).select({filterByFormula,maxRecords:1}).firstPage();
  return records[0]||null;
 }
 async createJob(runKey,postRecordId,nowUTCISO){
  const fields={RunKey:runKey,StartTime:nowUTCISO};
  if(postRecordId) fields.Post=[postRecordId];
  return await this.base(TABLES.jobs).create(fields);
 }
 async updateJob(jobRecordId,fields){
  return await this.base(TABLES.jobs).update(jobRecordId,fields);
 }
 async createPublished(jobRecordId,platform,isSuccess,message,platformPostId){
  const fields={
    Job:[jobRecordId],
    Platform:platform,
    IsSuccess:!!isSuccess,
    ErrorMessage:message||'',
    PlatformPostId:platformPostId||''
  };
  return await this.base(TABLES.published).create(fields);
 }
 async updatePostCooldown(postRecordId,fields){
  return await this.base(TABLES.posts).update(postRecordId,fields);
 }
}

module.exports={AirtableClient,isoNow,runKeyUTC};
