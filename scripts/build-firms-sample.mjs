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
 const latitude=Number(get('latitude')),longitude=Number(get('longitude')),brightness=Number(get('brightness')||get('bright_ti4')),frp=Number(get('frp'))||0,date=get('acq_date'),time=String(get('acq_time')||'').padStart(4,'0'),rawConfidence=String(get('confidence')||'').toLowerCase();
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!date)continue;
 const confidence=rawConfidence==='h'||rawConfidence==='high'?90:rawConfidence==='n'||rawConfidence==='nominal'?60:rawConfidence==='l'||rawConfidence==='low'?30:Number(rawConfidence)||0;
 records.push({latitude,longitude,brightness,frp,date,time,confidence,satellite:get('satellite')||'VIIRS'});
}

const newest=records.reduce((max,r)=>r.date>max?r.date:max,'');
const cutoff=new Date(`${newest}T00:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-29);
const cutoffDate=cutoff.toISOString().slice(0,10);
const recent=records.filter(r=>r.date>=cutoffDate);
const persistence=new Map();
for(const record of recent){const key=`${Math.round(record.latitude*100)}:${Math.round(record.longitude*100)}`;const group=persistence.get(key)||{dates:new Set(),observations:0};group.dates.add(record.date);group.observations++;persistence.set(key,group);}
const byDay=new Map();
for(const record of recent){const day=byDay.get(record.date)||[];day.push(record);byDay.set(record.date,day);}
const selected=[];
for(const day of byDay.values())selected.push(...day.sort((a,b)=>(b.frp+b.brightness/20)-(a.frp+a.brightness/20)).slice(0,200));
for(const [index,record] of selected.entries()){const key=`${Math.round(record.latitude*100)}:${Math.round(record.longitude*100)}`,group=persistence.get(key);record.id=`FIRMS-${record.date.replaceAll('-','')}-${record.time}-${index+1}`;record.persistenceDays=group?.dates.size||1;record.persistenceObservations=group?.observations||1;record.persistenceScore=Math.round((record.persistenceDays/30)*100);}
const payload={source:'NASA FIRMS VIIRS',generatedAt:new Date().toISOString(),from:cutoffDate,to:newest,totalRecentObservations:recent.length,observations:selected};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(payload));
console.log(`Wrote ${selected.length} of ${recent.length} recent observations (${cutoffDate} to ${newest}) to ${output}`);
