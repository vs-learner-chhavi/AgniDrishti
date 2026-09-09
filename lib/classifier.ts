export type Classification = 'Industrial Fire' | 'Gas Flare' | 'Crop Burning' | 'Wildfire' | 'Mining';
export type ClassificationInput = { brightnessKelvin:number; firmsConfidence:number; persistence:number; industrialDistanceKm:number; landCover?:'industrial'|'forest'|'cropland'|'mining'|'unknown' };
export type ClassificationResult = { classification:Classification; confidence:number; risk:'LOW'|'MODERATE'|'HIGH'|'CRITICAL'; explanations:{feature:string;contribution:number}[] };

// Transparent baseline. Replace with the trained model artifact when available.
export function classifyThermalEvent(input:ClassificationInput):ClassificationResult {
 const scores:Record<Classification,number>={'Industrial Fire':.2,'Gas Flare':.15,'Crop Burning':.15,'Wildfire':.15,Mining:.15};
 if(input.industrialDistanceKm<=2)scores['Industrial Fire']+=.42;
 if(input.persistence>=75)scores['Gas Flare']+=.35;
 if(input.landCover==='cropland')scores['Crop Burning']+=.42;
 if(input.landCover==='forest')scores.Wildfire+=.42;
 if(input.landCover==='mining')scores.Mining+=.42;
 if(input.brightnessKelvin>=335)scores['Industrial Fire']+=.12;
 if(input.firmsConfidence>=80)scores['Industrial Fire']+=.08;
 const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
 const [classification,rawScore]=ranked[0] as [Classification,number];
 const confidence=Math.min(99,Math.round(55+rawScore*40));
 const riskScore=input.brightnessKelvin*.7+input.persistence*.3;
 const risk=riskScore>=330?'CRITICAL':riskScore>=305?'HIGH':riskScore>=280?'MODERATE':'LOW';
 return {classification,confidence,risk,explanations:[
  {feature:'Industrial proximity',contribution:input.industrialDistanceKm<=2?.42:-.08},
  {feature:'Thermal intensity',contribution:input.brightnessKelvin>=335?.31:.12},
  {feature:'Historical persistence',contribution:input.persistence>=75?.24:.08},
  {feature:'FIRMS confidence',contribution:input.firmsConfidence>=80?.18:.05}
 ]};
}
