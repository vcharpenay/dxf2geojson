const fs = require('fs');
const dxf = require('dxf');

/////////////////////////////////////////////////////// basic GeoJSON transforms

const MIN_PRECISION = 0.01;

function joins(e1, e2) {
    // TODO other types? E.g. ELLIPSE
    if (e1.type != 'LINE' || e2.type != 'LINE') return false;

    return dist(e1.end, e2.start) < MIN_PRECISION
        || dist(e1.end, e2.end) < MIN_PRECISION;
}

function joinsSymmetrically(e, ep) {
    // TODO same as above
    if (e.type != 'LINE' || ep.type != 'LINE') return false;

    return dist(e.end, ep.start) < MIN_PRECISION
        || dist(e.end, ep.end) < MIN_PRECISION
        || dist(e.start, ep.start) < MIN_PRECISION
        || dist(e.start, ep.end) < MIN_PRECISION;
}

function rounded(val) {
    return Math.round(val / MIN_PRECISION) * MIN_PRECISION;
}

function asArray(p) {
    // TODO round up to 2 decimals
    return [ rounded(p.x), rounded(p.y), rounded(p.z) ];
}

function dist(p1, p2) {
    if (!(p1 instanceof Array)) p1 = asArray(p1);
    if (!(p2 instanceof Array)) p2 = asArray(p2);

    let x2 = (p2[0] - p1[0]) * (p2[0] - p1[0]);
    let y2 = (p2[1] - p1[1]) * (p2[1] - p1[1]);
    let z2 = (p2[2] - p1[2]) * (p2[2] - p1[2]);
    return Math.sqrt(x2 + y2 + z2);
}

function asLineString(entities) {
    let coords = [
        asArray(entities[0].start),
        asArray(entities[entities.length - 1].end)
    ];

    return {
        type: 'LineString',
        coordinates: coords
    }
}

function asPolygon(entities) {
    if (entities.length > 1) {
        let coords = entities.reduce((coords, e, i, entities) => {
            if (e.type == 'LINE') {
                if (i > 0) {
                    let prev = entities[i - 1];
                    let next = entities[i];

                    if (joins(next, prev)) coords.push(asArray(next.start));
                    else if (joinsSymmetrically(next, prev)) coords.push(asArray(next.end));
                    else console.error('Entities in the polygon do not join.');
                } else {
                    let first = entities[0];
                    let next = entities[1];

                    if (joins(first, next)) coords.push(asArray(first.start), asArray(first.end));
                    else if (joinsSymmetrically(first, next)) coords.push(asArray(first.end), asArray(first.start));
                    else console.error('First entities in the polygon do not join.');
                }
            } else {
                console.error(`Entity of type ${e.type} found in Polygon.`);
            }
    
            return coords;
        }, []);
    
        if (dist(coords[0], coords[coords.length - 1]) > MIN_PRECISION) {
            coords.push(coords[0]); // to enforce polygon is closed
            console.error('Poylgon is not closed');
        }

        return {
            type: 'Polygon',
            coordinates: [ coords ]
        };
    } else {
        console.error('Trying to turn a single entity into a polygon. A polygon requires at least two entities.');
    }
}

///////////////////////////////////////////////////////// DXF aggregate function

function aggregate(entities) {
    // find joins (entity index -> list of entity indices)

    let joinIndex = entities.map(e => {
        return entities.filter(ep => e != ep && joinsSymmetrically(e, ep));
    });

    // fixed point: walk paths; if several joins, choose shortest line

    let agg = [];
    let processed = new Set();
    while (processed.size < entities.length) {
        let path = [];

        // find starting point that has not been processed yet
        let i = 0;
        while (processed.has(i)) i++;

        // walk path until no more join is found or path is closed
        let next = entities[i];
        while (next && !(path.length > 2 && joins(path[0], path[path.length - 1]))) {
            path.push(next);
            processed.add(i);

            // no walk backward
            let neighbors = joinIndex[i].filter(e => path.indexOf(e) < 0);

            // sort neighbors by their distance
            // TODO build all possible polygons and take smallest? (With pruning)
            let byDist = (e, ep) => dist(e.start, e.end) - dist(ep.start, ep.end);
            next = neighbors.sort(byDist)[0];

            if (next) i = entities.indexOf(next);
        }

        agg.push(path);
    }

    fs.writeFileSync('tmp.json', JSON.stringify(agg));

    return agg;
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

let bearingWallEntities = parsed.entities.filter(e => e.layer == 'MURS' && e.type == 'LINE');

let bearingWalls = aggregate(bearingWallEntities)
.map(asPolygon)
.filter(p => p) // excludes polygons for which transformation failed 
.map(p => ({
    type: 'Feature',
    properties: { type: 'BearingWall' },
    geometry: p
}));
// let bearingWalls = [];

// dividing walls

let divWallEntities = parsed.entities.filter(e => e.layer == 'CLOIS4' && e.type == 'LINE');

let divWalls = aggregate(divWallEntities)
.map(asPolygon)
.filter(p => p) // excludes polygons for which transformation failed 
.map(p => ({
    type: 'Feature',
    properties: { type: 'DividingWall' },
    geometry: p
}));
// let divWalls = [];

// doors

// let doorEntities = parsed.entities.filter(e => e.layer == 'PORTE' && e.type == 'LINE');

// let doors = aggregate(doorEntities)
// .map(chain => ({
//     type: 'Feature',
//     properties: { type: 'Door' },
//     geometry: asLineString(chain)
// }));
let doors = [];

// windows (TODO)

let windows = [];

let geojson = {
    type: 'FeatureCollection',
    features: [...bearingWalls, ...divWalls, ...doors, ... windows]
};

fs.writeFileSync('4ET.geojson', JSON.stringify(geojson));