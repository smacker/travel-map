const fs = require('fs').promises;
const https = require('https');

const dataJSON = fs.readFile('./data.json').then(buf => JSON.parse(buf));
const allCountriesJSON = fs
  .readFile('./vendor/countries.geojson')
  .then(buf => JSON.parse(buf));
const citiesJSON = fs
  .readFile('./dist/cities.geojson')
  .then(buf => JSON.parse(buf));

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

    return geojson;
  })
  .then(geojson =>
    fs.writeFile('./dist/countries.geojson', JSON.stringify(geojson))
  )
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
        coordinates: c.coordinates
      },
      properties: {
        name: c.name,
        country: c.country
      }
    }));
  })
  .then(geojson =>
    fs.writeFile('./dist/cities.geojson', JSON.stringify(geojson))
  )
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
