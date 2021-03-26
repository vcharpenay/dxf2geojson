const fs = require('fs');
const dxf = require('dxf');
const math = require('mathjs');

const MIN_PRECISION = 0.01;

function point2vec(p) {
    return [p.x, p.y, p.z];
}

function almostEq(p1, p2) {
    return math.norm(math.subtract(p2, p1)) < MIN_PRECISION;
}

function lines2points(entities) {
    return entities.reduce((list, e) => {
        if (e.type == 'LINE') {
            // add starting point if not already in the list
            let startCoords = point2vec(e.start);
            let i1 = list.findIndex(p => almostEq(p.coords, startCoords));
            if (i1 < 0) {
                list.push({ coords: startCoords, neighbors: [] });
                i1 = list.length - 1;
            }

            // add end point if not already in the list
            let endCoords = point2vec(e.end);
            let i2 = list.findIndex(p => almostEq(p.coords, endCoords));
            if (i2 < 0) {
                list.push({ coords: endCoords, neighbors: [] });
                i2 = list.length - 1;
            }

            // update neighbors of starting point and end point
            let p1 = list[i1], p2 = list[i2];
            if (!p1.neighbors.some(i => almostEq(list[i].coords, p2.coords))) p1.neighbors.push(i2);
            if (!p2.neighbors.some(i => almostEq(list[i].coords, p1.coords))) p2.neighbors.push(i1);
        }

        return list;
    }, []);
}

function points2paths(points) {
    let paths = [];
    let processed = new Set();

    while (processed.size < points.length) {
        let path = [];

        // find starting point that has not been processed yet
        let i = 0;
        while (processed.has(i)) i++;

        // walk path until no neighbor is found or path is closed
        while (i != undefined) {
            let p = points[i];

            path.push(p.coords);
            processed.add(i);

            // no walk backward unless to close loop
            let ifNotPrevious = ip => !(path.length > 1 && almostEq(path[path.length - 2], points[ip].coords));
            let ifNotInPath = ip => !path.some((coords, ci) => ci > 0 && almostEq(coords, points[ip].coords));
            let neighbors = p.neighbors
                .filter(ifNotPrevious)
                .filter(ifNotInPath);

            // sort neighbors by their distance to current point
            let byDist = (ip, is) => {
                let vp = math.subtract(points[ip].coords, p.coords);
                let vs = math.subtract(points[is].coords, p.coords);
                return math.norm(vp) - math.norm(vs);
            };
            neighbors.sort(byDist);

            // TODO choose neighbor that is closest to path's origin point

            i = neighbors[0];

            // TODO remove
            if (path.length > 1 && almostEq(p.coords, path[0])) i = undefined;
        }

        paths.push(path);
    }

    return paths;
}

function path2feature(path) {
    if (path.length > 2 && almostEq(path[0], path[path.length - 1])) {
        // ensure first/last coordinates are strictly equal
        path.pop();
        path.push(path[0]);

        // path is closed -> polygon
        return {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [ path ]
            }
        };
    } else {
        // path is open -> line string
        return {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: path
            }
        };
    }
}

/////////////////////////////////////////////////////////////////////////// main

let parsed = {};

if (fs.existsSync('4ET.json')) {
    parsed = JSON.parse(fs.readFileSync('4ET.json'));
} else {
    let f = fs.readFileSync('../4ET.dxf', 'utf-8');
    const helper = new dxf.Helper(f);

    parsed = helper.parsed;
    fs.writeFileSync('4ET.json', JSON.stringify(parsed));
}

// bearing walls

let bearingWallEntities = parsed.entities.filter(e => e.layer == 'MURS');
let divWallEntities = parsed.entities.filter(e => e.layer == 'CLOIS4');

let lines2features = entities => {
    return points2paths(lines2points(entities)).map((path, i) => {
        let f = path2feature(path);
        f.properties.id = i;
        return f;
    });
};

let withType = (feature, type) => {
    feature.properties.type = type;
    return feature;
};

let coll = {
    type: 'FeatureCollection',
    features: [
        ...lines2features(bearingWallEntities).map(f => withType(f, 'BearingWall')),
        ...lines2features(divWallEntities).map(f => withType(f, 'DividingWall'))
    ]
}

// TODO add PORTE, VITRE

fs.writeFileSync('4ET.geojson', JSON.stringify(coll));