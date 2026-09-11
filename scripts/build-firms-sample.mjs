import {createReadStream,mkdirSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {dirname} from 'node:path';

const [input,output='public/data/firms-recent.json']=process.argv.slice(2);
if(!input)throw new Error('Usage: node scripts/build-firms-sample.mjs <FIRMS.csv> [output.json]');

const records=[];
let headers=[];
const lines=createInterface({input:createReadStream(input)});
for await(const line of lines){
 if(!headers.length){headers=line.split(',');continue;}
 const row=line.split(','),get=name=>row[headers.indexOf(name)];
 const latitude=Number(get('latitude')),longitude=Number(get('longitude')),brightness=Number(get('brightness')||get('bright_ti4')),frp=Number(get('frp'))||0,date=get('acq_date');
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!date)continue;
 records.push({latitude,longitude,brightness,frp,date,satellite:get('satellite')||'VIIRS'});
}

const newest=records.reduce((max,r)=>r.date>max?r.date:max,'');
const cutoff=new Date(`${newest}T00:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-29);
const cutoffDate=cutoff.toISOString().slice(0,10);
const recent=records.filter(r=>r.date>=cutoffDate);
const byDay=new Map();
for(const record of recent){const day=byDay.get(record.date)||[];day.push(record);byDay.set(record.date,day);}
const selected=[];
for(const day of byDay.values())selected.push(...day.sort((a,b)=>(b.frp+b.brightness/20)-(a.frp+a.brightness/20)).slice(0,200));
const payload={source:'NASA FIRMS VIIRS',generatedAt:new Date().toISOString(),from:cutoffDate,to:newest,totalRecentObservations:recent.length,observations:selected};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(payload));
console.log(`Wrote ${selected.length} of ${recent.length} recent observations (${cutoffDate} to ${newest}) to ${output}`);
