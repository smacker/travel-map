(() => {
  // Constants

  const initialCoords = [30, 15];

  const colors = [
    '#800026',
    '#BD0026',
    '#E31A1C',
    '#FC4E2A',
    '#FD8D3C',
    '#FEB24C',
    '#FED976',
    '#FFEDA0',
    '#FFFFCC'
  ];
  const birthColor = colors[0];
  const livedColor = colors[1];
  const oldColor = colors[colors.length - 1];
  const scaleColors = colors.slice(2, colors.length - 1);

  const maxClusterRadius = 60;

  // Data requests

  const countriesPromise = fetch('countries.geojson').then(d => {
    if (d.status !== 200) {
      throw `countries.geojson: incorrect status code: ${d.status}`;
    }
    return d.json();
  });
  const citiesPromise = fetch('cities.geojson').then(d => {
    if (d.status !== 200) {
      throw `cities.geojson: incorrect status code: ${d.status}`;
    }
    return d.json();
  });

  // Create the map itself

  const map = L.map('mapid').setView(initialCoords, 3);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);

  // Helpers

  function getCountryYear(country, first) {
    if (!country.years || country.years.length == 0) {
      return null;
    }
    return country.years[first ? 0 : country.years.length - 1];
  }

  // Add Layers

  countriesPromise
    .then(geojson => {
      const countries = geojson.features.map(f => f.properties);

      const maxYear = countries.reduce((res, c) => {
        const year = getCountryYear(c);
        return year > res ? year : res;
      }, null);
      const minYear = countries.reduce((res, c) => {
        const year = getCountryYear(c, true);
        return year && year < res ? year : res;
      }, maxYear);

      function getColor(country) {
        if (country.birth) {
          return birthColor;
        }

        if (country.lived) {
          return livedColor;
        }

        if (!country.years || country.years.length == 0) {
          return oldColor;
        }

        const n = scaleColors.length - 1;
        const lastYear = getCountryYear(country);
        const i =
          n - Math.ceil((n / (maxYear - minYear)) * (lastYear - minYear));
        return scaleColors[i];
      }

      // Info control on country hover

      const info = L.control();

      info.onAdd = function(map) {
        this._div = L.DomUtil.create('div', 'info');
        this.update();
        return this._div;
      };

      info.update = function(props) {
        this._div.hidden = !props;
        if (!props) {
          return;
        }
        let status = [];
        if (props.birth) {
          status.push('born');
        }
        if (props.lived) {
          // todo: support no dates, more than 1 interval
          status.push(`lived, ${props.lived[0]}-${props.lived[1]}`);
        }
        if (!props.lived) {
          status.push('visited');
        }
        if (!props.lived && props.years) {
          status.push(props.years.join(', '));
        }

        this._div.innerHTML = `<h4>Country</h4><b>${props.name}</b> ${
          status.length > 0 ? '(' + status.join(', ') + ')' : ''
        }`;
      };

      info.addTo(map);

      // List of visited countries control

      function sortCountries(a, b) {
        const aYear = getCountryYear(a);
        const bYear = getCountryYear(b);
        if (aYear == bYear) {
          return a.name < b.name;
        }
        if (bYear < aYear) {
          return -1;
        } else {
          return 1;
        }
      }

      function countriesGroupTemplate(name, countries) {
        const items = countries.map(
          c => `<li><i style="background:${getColor(c)}"></i> ${c.name}</li>`
        );
        return `<h4>${name}</h4><ul>${items.join('')}</ul>`;
      }

      const legend = L.control({ position: 'bottomleft' });

      legend.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'info list');
        L.DomEvent.disableScrollPropagation(div);

        const born = countries.filter(c => c.birth)[0];
        const lived = countries
          .filter(c => !c.birth && c.lived)
          .sort(sortCountries);
        const visited = countries
          .filter(c => !c.birth && !c.lived)
          .sort(sortCountries);

        div.innerHTML = [
          countriesGroupTemplate('Born', [born]),
          countriesGroupTemplate('Lived', lived),
          countriesGroupTemplate('Visited', visited)
        ].join('');

        return div;
      };

      legend.addTo(map);

      // Counties layer

      let geojsonLayer;

      function style(feature) {
        const country = feature.properties;
        return {
          fillColor: getColor(country),
          weight: 2,
          opacity: 1,
          color: 'white',
          dashArray: '3',
          fillOpacity: 0.6
        };
      }

      function highlightFeature(e) {
        const layer = e.target;

        layer.setStyle({
          color: '#666',
          dashArray: '',
          fillOpacity: 0.7
        });

        if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
          layer.bringToFront();
        }

        info.update(layer.feature.properties);
      }

      function resetHighlight(e) {
        geojsonLayer.resetStyle(e.target);
        info.update();
      }

      function onEachFeature(feature, layer) {
        layer.on({
          mouseover: highlightFeature,
          mouseout: resetHighlight
        });
      }

      geojsonLayer = L.geoJson(geojson, {
        style: style,
        onEachFeature: onEachFeature
      }).addTo(map);

      // Cities layer

      return citiesPromise.then(cgeojson => {
        const markers = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius
        });
        markers.addLayer(L.geoJson(cgeojson));
        markers.bindPopup(layer => {
          const p = layer.feature.properties;
          return `${p.name}, ${p.country}`;
        });
        markers.addTo(map);
      });
    })
    .catch(err => window.alert(`Error happened: ${err}`));
})();
