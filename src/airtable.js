const Airtable=require('airtable');
const{DateTime}=require('luxon');

function isoNow(){return DateTime.now().toUTC().toISO();}
function runKeyUTC(nowUTC){return `${nowUTC.toFormat('yyyy-LL-dd_HH')}:00`;}

class AirtableClient{
 constructor(){
  const apiKey=process.env.AIRTABLE_TOKEN;
  const baseId=process.env.AIRTABLE_BASE_ID;
  if(!apiKey||!baseId) throw new Error('Missing Airtable credentials');
  this.base=new Airtable({apiKey}).base(baseId);
  this.postsTable=process.env.AIRTABLE_POSTS_TABLE||'Posts';
  this.jobsTable=process.env.AIRTABLE_JOBS_TABLE||'Jobs';
  this.publishedTable=process.env.AIRTABLE_PUBLISHED_TABLE||'Published';
 }
 async findJobByRunKey(runKey){
  const filterByFormula=`{RunKey} = "${runKey}"`;
  const records=await this.base(this.jobsTable).select({filterByFormula,maxRecords:1}).firstPage();
  return records[0]||null;
 }
 async listEligiblePosts(cutoffISO){
  const filterByFormula=`AND(
    {Status} = "Active",
    FIND("X", ARRAYJOIN({Platforms})) > 0,
    FIND("Threads", ARRAYJOIN({Platforms})) > 0,
    OR({LastPostedOnXTime} = "", {LastPostedOnXTime} <= DATETIME_PARSE("${cutoffISO}")),
    OR({LastPostedOnThreadsTime} = "", {LastPostedOnThreadsTime} <= DATETIME_PARSE("${cutoffISO}"))
  )`;
  return await this.base(this.postsTable).select({filterByFormula}).all();
 }
 async createJob(runKey,postRecordId,nowUTCISO){
  const fields={RunKey:runKey,StartTime:nowUTCISO};
  if(postRecordId) fields.Post=[postRecordId];
  return await this.base(this.jobsTable).create(fields);
 }
 async updateJob(jobRecordId,fields){
  return await this.base(this.jobsTable).update(jobRecordId,fields);
 }
 async createPublished(jobRecordId,platform,isSuccess,message,platformPostId,nowUTCISO){
  const fields={
    Job:[jobRecordId],
    Platform:platform,
    IsSuccess:!!isSuccess,
    ErrorMessage:message||'',
    PlatformPostId:platformPostId||'',
    Time:nowUTCISO
  };
  return await this.base(this.publishedTable).create(fields);
 }
 async updatePostCooldown(postRecordId,fields){
  return await this.base(this.postsTable).update(postRecordId,fields);
 }
}

module.exports={AirtableClient,isoNow,runKeyUTC};
