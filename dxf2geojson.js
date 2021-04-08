const fs = require('fs');
const dxf = require('dxf');
const math = require('mathjs');

const MIN_PRECISION = 0.01;

function obj2vec(p) {
    return [p.x, p.y, p.z];
}

function almostEq(p1, p2) {
    return math.norm(math.subtract(p2, p1)) < MIN_PRECISION;
}

function lines2points(entities) {
    let points = entities.reduce((list, e) => {
        if (e.type == 'LINE') {
            // add starting point if not already in the list
            let startCoords = obj2vec(e.start);
            let i1 = list.findIndex(p => almostEq(p.coords, startCoords));
            if (i1 < 0) {
                list.push({ coords: startCoords, neighbors: [] });
                i1 = list.length - 1;
            }

            // add end point if not already in the list
            let endCoords = obj2vec(e.end);
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

    let pl = points.length;
    let ll = points.reduce((cnt, p) => cnt + p.neighbors.length, 0);
    console.log(`found ${pl} points and ${ll} lines`);

    return points;
}

function aligned(p1, p, p2) {
    // note: only considers the case where pp is within [p, ps]
    // // TODO not a proper inequation (but good enough)
    return math.distance(p1, p) + math.distance(p, p2) - math.distance(p1, p2) < MIN_PRECISION * MIN_PRECISION;
}

function normalize(points) {
    let triples = [];

    // find triples of points that are aligned
    points.forEach((p1, i1) => {
        p1.neighbors.forEach(i2 => {
            let p2 = points[i2];

            points.forEach((p, i) => {
                if (i != i1 && i != i2 && aligned(p1.coords, p.coords, p2.coords)) {
                    let t = [i1, i, i2];

                    // note: duplicate entries: [p1, p, p2] and [p2, p, p1]
                    if (!triples.some(tp => t[0] == tp[0] && t[1] == tp[1] && t[2] == tp[2])) triples.push(t);
                }
            })
        });
    });

    console.log(`found ${triples.length} alignments to normalize`);

    // normalize neighborhood relation for triples of aligned points
    triples.forEach(t => {
        let p1 = points[t[0]];
        let p2 = points[t[1]];
        let p3 = points[t[2]];

        // remove first and last points from each other's neighborhood
        p1.neighbors = p1.neighbors.filter(i => !almostEq(p3.coords, points[i].coords));
        p3.neighbors = p3.neighbors.filter(i => !almostEq(p1.coords, points[i].coords));

        // add both points to middle points's neighborhood
        if (!p2.neighbors.some(i => almostEq(p1.coords, points[i].coords))) p2.neighbors.push(t[0]);
        if (!p2.neighbors.some(i => almostEq(p3.coords, points[i].coords))) p2.neighbors.push(t[2]);

        // add middle point to first and last points neighborhood
        if (!p1.neighbors.some(i => almostEq(p2.coords, points[i].coords))) p1.neighbors.push(t[1]);
        if (!p3.neighbors.some(i => almostEq(p2.coords, points[i].coords))) p3.neighbors.push(t[1]);
    });

    let pl = points.length;
    let ll = points.reduce((cnt, p) => cnt + p.neighbors.length, 0);
    console.log(`found ${pl} points and ${ll} lines after normalization`);
}

function points2paths(points) {
    normalize(points);

    let paths = [];

    // gather all lines that are not yet processed
    let remaining = points.reduce((r, p, i) => {
        p.neighbors.forEach(j => {
            let line = new Set();
            
            line.add(i);
            line.add(j);

            if (!r.some(l => l.has(i) && l.has(j))) r.push(line);
        });

        return r;
    }, []);

    // FIXME why?
    remaining = remaining.filter(l => {
        let isPoint = l.size == 2;
        if (!isPoint) console.error(`found incorrect point: ${l}`);
        return isPoint;
    });

    while (remaining.length > 0) {
        let path = [];

        let [i, j] = remaining.shift();

        // walk line that has not been processed yet
        path.push(points[i].coords);

        i = j;

        // walk path until no neighbor is found or path is closed
        while (i != undefined) {
            let p = points[i];

            path.push(p.coords);

            // path is closed, exit loop
            if (path.length > 1 && almostEq(p.coords, path[0])) break;

            // no walk backward unless to close loop
            let ifNotPrevious = ip => !(path.length > 1 && almostEq(path[path.length - 2], points[ip].coords));
            let ifNotInPath = ip => !path.some((coords, ci) => ci > 0 && almostEq(coords, points[ip].coords));
            let neighbors = p.neighbors
                .filter(ifNotPrevious)
                .filter(ifNotInPath);

            // sort neighbors by their distance to path's starting point
            let byDist = (ip, is) => {
                    let vp = math.subtract(points[ip].coords, path[0]);
                    let vs = math.subtract(points[is].coords, path[0]);
                    return math.norm(vp) - math.norm(vs);
            };
            neighbors.sort(byDist);

            let j = neighbors[0];

            // mark walked line as processed
            remaining = remaining.filter(l => !(l.has(i) && l.has(j)));

            i = j;
        }

        paths.push(path);
    }

    console.log(`found ${paths.length} paths from point list`);

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

    parsed = helper.groups;
    fs.writeFileSync('4ET.json', JSON.stringify(parsed));
}

let lines2features = (entities, layer) => {
    console.log(`processing layer ${layer}...`);

    let features = points2paths(lines2points(entities)).map((path, i) => {
        let f = path2feature(path);
        f.properties.id = i;
        f.properties.layer = layer;
        return f;
    });

    console.log(`created ${features.filter(f => f.geometry.type == 'Polygon').length} polygons`);
    console.log(`created ${features.filter(f => f.geometry.type == 'LineString').length} line strings`);

    return features;
};

let layers = ['MURS', 'CLOIS4']; // TODO PORTE, VITRE
// let layers = ['MURS'];

let coll = {
    type: 'FeatureCollection',
    features: layers
        .map(l => lines2features(parsed[l], l))
        .reduce((agg, f) => agg.concat(f))
};

fs.writeFileSync('4ET.geojson', JSON.stringify(coll));