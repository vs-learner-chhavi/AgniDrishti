export type PersistenceResult={score:number;observations:number;windowDays:number;pattern:'PERSISTENT'|'TRANSIENT'|'INSUFFICIENT_HISTORY'};

export function estimatePersistence(current:{latitude:number;longitude:number},history:{latitude:number;longitude:number;acqDate:string}[],windowDays=30):PersistenceResult{
 const nearby=history.filter(h=>distanceKm(current.latitude,current.longitude,h.latitude,h.longitude)<=0.75);
 const uniqueDays=new Set(nearby.map(h=>h.acqDate)).size;
 if(uniqueDays<2)return {score:0,observations:nearby.length,windowDays,pattern:'INSUFFICIENT_HISTORY'};
 const score=Math.min(100,Math.round(uniqueDays/windowDays*100));
 return {score,observations:nearby.length,windowDays,pattern:score>=55?'PERSISTENT':'TRANSIENT'};
}
function distanceKm(a:number,b:number,c:number,d:number){const R=6371,r=Math.PI/180;const x=(c-a)*r,y=(d-b)*r;const q=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
