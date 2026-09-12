"""Convert the official SOI State Boundary shapefile to a web display layer.
Usage: python scripts/build_soi_boundaries.py "/path/to/State Boundary.shp"
Requires pyshp, pyproj, shapely. Source: https://surveyofindia.gov.in/pages/administrative-boundary-data-base-abdb-
"""
from pathlib import Path
import sys,json,hashlib
import shapefile
from pyproj import CRS,Transformer
from shapely.geometry import shape,mapping,Point
from shapely.ops import transform
source=Path(sys.argv[1]);r=shapefile.Reader(str(source))
project=Transformer.from_crs(CRS.from_wkt(source.with_suffix('.prj').read_text()),4326,always_xy=True).transform
features=[]
for record in r.iterShapeRecords():
 props=record.record.as_dict();geom=transform(project,shape(record.shape.__geo_interface__))
 geom=geom.simplify(.008,preserve_topology=True)
 label=geom.representative_point()
 features.append({'type':'Feature','properties':{'name':props['STATE'].title(),'country':props['Country'],'label':[label.y,label.x]},'geometry':mapping(geom)})
assert len(features)==40
for name in ['Jammu And Kashmir','Ladakh','Andaman & Nicobar','Lakshadweep']:assert any(f['properties']['name']==name for f in features)
# Confirm northern extent was retained during reprojection/simplification.
assert max(shape(f['geometry']).bounds[3] for f in features)>37
result={'type':'FeatureCollection','source':'Survey of India Administrative Boundary Data Base','sourceUrl':'https://surveyofindia.gov.in/pages/administrative-boundary-data-base-abdb-','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'note':'Official Indian boundary depiction; geometry simplified for display, not surveying.','features':features}
out=Path(__file__).resolve().parents[1]/'public/data/india-soi-boundaries.geojson'
out.write_text(json.dumps(result,separators=(',',':')))
print(len(features),'features;',out.stat().st_size,'bytes')
