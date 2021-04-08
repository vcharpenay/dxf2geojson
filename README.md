# Translation from DXF to GeoJSON

DXF is a exchange format used by AutoCAD for graphical objects. GeoJSON is an
[IETF standard](https://tools.ietf.org/html/rfc7946) for geometries. The two
can be used interchangeably e.g. for modeling buildings.

The `dxf2geojson` translator attempts to reconstructs GeoJSON geometries
(polygons and  lines strings, also called polylines) from DXF lines.

## Usage

```sh
$ npm install
$ node dxf2geojson.js <in.dxf> <out.geojson>
```