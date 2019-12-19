const fs = require('fs');
const fsPromises = fs.promises;
const https = require('https');

const dataFile = './data.json';
const allCountriesFile = './vendor/countries.geojson';
const countriesFile = './dist/countries.geojson';
const citiesFile = './dist/cities.geojson';

const dataJSON = fsPromises.readFile(dataFile).then(buf => JSON.parse(buf));
const allCountriesJSON = fsPromises
  .readFile(allCountriesFile)
  .then(buf => JSON.parse(buf));
const citiesJSON = fsPromises
  .access(citiesFile, fs.constants.F_OK)
  .then(() => {
    return fsPromises.readFile(citiesFile).then(buf => JSON.parse(buf));
  })
  .catch(() => {
    return [];
  });

Promise.all([dataJSON, allCountriesJSON])
  .then(([data, geojson]) => {
    const codes = Object.keys(data);

    geojson.features = geojson.features
      .filter(f => codes.includes(f.properties.ISO_A2))
      .map(f => {
        const code = f.properties.ISO_A2;
        f.properties = {
          ...data[code],
          code
        };
        delete f.properties.cities;
        return f;
      });

    return parse(geojson, 7);
  })
  .then(geojson => fsPromises.writeFile(countriesFile, JSON.stringify(geojson)))
  .then(() => console.log('countries.geojson generated'));

function cityKey(c) {
  return `${c.name}_${c.country}`;
}

Promise.all([dataJSON, citiesJSON])
  .then(([data, prevCitiesGeoJSON]) => {
    const codes = Object.keys(data);
    const allCities = codes
      .map(code => data[code])
      .filter(c => c.cities && c.cities.length)
      .map(c => c.cities.map(city => ({ name: city, country: c.name })))
      .flat();

    const prevCities = prevCitiesGeoJSON.reduce((acc, f) => {
      const c = f.properties;
      acc[cityKey(c)] = f.geometry.coordinates;
      return acc;
    }, {});

    // get coordinates from previous geojson
    const oldCities = allCities
      .filter(c => prevCities.hasOwnProperty(cityKey(c)))
      .map(c => {
        c.coordinates = prevCities[cityKey(c)];
        return c;
      });

    // use geocoder to get coordinates for new cities
    const newCitiesPromise = allCities
      .filter(c => !prevCities.hasOwnProperty(cityKey(c)))
      .map(c => {
        return httpsGet(
          `https://nominatim.openstreetmap.org/search?q=${c.name},%20${c.country}&format=json`,
          {
            headers: {
              'User-Agent': 'my travels generator'
            }
          }
        )
          .then(buf => JSON.parse(buf))
          .then(json => {
            const res = json.filter(item =>
              ['city', 'town', 'administrative'].includes(item.type)
            );
            if (!res.length) {
              console.log(`not found for ${c.name}, json:`);
              console.log(json);
              throw 'stop';
            }
            return res[0];
          })
          .then(json => {
            c.coordinates = [json.lon, json.lat];
            return c;
          });
      });

    return Promise.all(newCitiesPromise).then(newCities => {
      return oldCities.concat(newCities);
    });
  })
  .then(cities => {
    return cities.map(c => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [+c.coordinates[0], +c.coordinates[1]]
      },
      properties: {
        name: c.name,
        country: c.country
      }
    }));
  })
  .then(geojson => fsPromises.writeFile(citiesFile, JSON.stringify(geojson)))
  .then(() => console.log('cities.geojson generated'));

function httpsGet(url, options) {
  return new Promise((resolve, reject) => {
    https
      .get(url, options || {}, res => {
        if (res.statusCode !== 200) {
          return reject(`incorrect status code: ${res.statusCode}`);
        }

        let rawData = '';
        res.on('data', d => {
          rawData += d;
        });
        res.on('end', () => {
          return resolve(rawData);
        });
      })
      .on('error', e => {
        return reject(e);
      });
  });
}

// The code below is taken from https://github.com/jczaplew/geojson-precision
// author: John J Czaplewski <jczaplew@gmail.com>
const parse = (() => {
  function parse(t, coordinatePrecision, extrasPrecision) {
    function point(p) {
      return p.map(function(e, index) {
        if (index < 2) {
          return 1 * e.toFixed(coordinatePrecision);
        } else {
          return 1 * e.toFixed(extrasPrecision);
        }
      });
    }

    function multi(l) {
      return l.map(point);
    }

    function poly(p) {
      return p.map(multi);
    }

    function multiPoly(m) {
      return m.map(poly);
    }

    function geometry(obj) {
      if (!obj) {
        return {};
      }

      switch (obj.type) {
        case 'Point':
          obj.coordinates = point(obj.coordinates);
          return obj;
        case 'LineString':
        case 'MultiPoint':
          obj.coordinates = multi(obj.coordinates);
          return obj;
        case 'Polygon':
        case 'MultiLineString':
          obj.coordinates = poly(obj.coordinates);
          return obj;
        case 'MultiPolygon':
          obj.coordinates = multiPoly(obj.coordinates);
          return obj;
        case 'GeometryCollection':
          obj.geometries = obj.geometries.map(geometry);
          return obj;
        default:
          return {};
      }
    }

    function feature(obj) {
      obj.geometry = geometry(obj.geometry);
      return obj;
    }

    function featureCollection(f) {
      f.features = f.features.map(feature);
      return f;
    }

    function geometryCollection(g) {
      g.geometries = g.geometries.map(geometry);
      return g;
    }

    if (!t) {
      return t;
    }

    switch (t.type) {
      case 'Feature':
        return feature(t);
      case 'GeometryCollection':
        return geometryCollection(t);
      case 'FeatureCollection':
        return featureCollection(t);
      case 'Point':
      case 'LineString':
      case 'Polygon':
      case 'MultiPoint':
      case 'MultiPolygon':
      case 'MultiLineString':
        return geometry(t);
      default:
        return t;
    }
  }

  return parse;
})();
