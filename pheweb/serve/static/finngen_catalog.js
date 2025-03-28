// FinnGen Catalog Plot Script - modified to use local API endpoint

function renderFinnGenPlot() {
  // Grab LocusZoom region from the element with id "lz-1"
  var regionData = document.getElementById('lz-1').dataset.region;
  if (!regionData) {
    console.error("No region data found on element with id 'lz-1'");
    return;
  }
  var parts = regionData.split(':');
  var chr = parts[0];
  var coords = parts[1].split('-');
  var start = parseInt(coords[0], 10);
  var end = parseInt(coords[1], 10);

  // Get the selected FinnGen endpoint or default to "E4_DIABETES"
  var endpointSelect = document.getElementById('endpoint-select');
  var selectedEndpoint = endpointSelect ? endpointSelect.value : "E4_DIABETES";

  // Build the URL for your new local API endpoint.
  // This URL uses the selected endpoint and passes the region (in "chr:start-end" format)
  var apiUrl = "/api/finngen/" + selectedEndpoint + "?region=" + regionData;

  // Fetch data from the local API endpoint
  fetch(apiUrl, { method: 'GET' })
    .then(function(response) {
      if (!response.ok) {
        throw new Error("Error fetching FinnGen data: " + response.status);
      }
      return response.json();
    })
    .then(function(data) {
      var associations = data.data;
      if (!associations || associations.length === 0) {
        document.getElementById("finngen-gwas-catalog").innerHTML = "No associations in this region.";
        updateFinnGenButton();
        return;
      }

      // Prepare arrays for Plotly.
      // Assuming each record in associations has "position" and "pval"
      var x = associations.map(function(record) {
        return record.position;
      });
      var y = associations.map(function(record) {
        return -Math.log10(record.pval);
      });
      // Optionally, if your API provides additional fields (e.g. variant ID, alleles),
      // you can extract and include them in customData
      var customData = associations.map(function(record) {
        return record; // or extract specific fields as needed
      });

      // Define the Plotly trace
      var trace = {
        x: x,
        y: y,
        mode: 'markers',
        type: 'scatter',
        name: selectedEndpoint,
        marker: { color: '#3500D3', opacity: 0.7, size: 8 },
        customdata: customData,
        hovertemplate:
          "<b>Position: %{x}</b><br>" +
          "-log10 p-value: %{y}<br><extra></extra>"
      };

      // A matching layout for consistent x-axis alignment
      var layout = {
        title: { text: "FinnGen Associations (" + selectedEndpoint + ")", font: { size: 14 } },
        showlegend: false,
        xaxis: {
          title: "Chromosome " + chr + " (Mb)",
          showgrid: false,
          zeroline: true,
          zerolinecolor: 'black',
          zerolinewidth: 1,
          ticks: 'outside',
          ticklen: 6,
          tickwidth: 1,
          tickcolor: 'black'
        },
        yaxis: {
          title: "<b>-log10 p-value</b>",
          showgrid: false,
          zeroline: true,
          zerolinecolor: 'black',
          zerolinewidth: 1,
          showline: true,
          ticks: 'outside',
          ticklen: 6,
          tickwidth: 1,
          tickcolor: 'black',
          rangemode: "tozero"
        },
        margin: { t: 34, b: 40, l: 50, r: 20 },
        plot_bgcolor: "white",
        height: 500
      };

      // Clear any existing content and render the new plot
      document.getElementById("finngen-gwas-catalog").innerHTML = "";
      Plotly.newPlot('finngen-gwas-catalog', [trace], layout)
        .then(function() {
          // Additional sync logic (if needed) can be placed here.
          updateFinnGenButton();
        });
    })
    .catch(function(error) {
      document.getElementById("finngen-gwas-catalog").innerHTML = "Error loading FinnGen plot: " + error.message;
      console.error(error);
    });
}

// Create or update the FinnGen results button.
function updateFinnGenButton() {
  var endpointSelect = document.getElementById('endpoint-select');
  if (!endpointSelect) return;
  var selectedEndpoint = endpointSelect.value;
  var finngenUrl = "https://results.finngen.fi/pheno/" + selectedEndpoint;

  var btn = document.getElementById("finngen-link");
  if (!btn) {
    btn = document.createElement("a");
    btn.id = "finngen-link";
    btn.className = "btn";
    btn.style.marginTop = "10px";
    btn.style.display = "inline-block";
    var container = document.getElementById("finngen-gwas-catalog");
    container.parentNode.insertBefore(btn, container.nextSibling);
  }
  btn.href = finngenUrl;
  btn.textContent = "View " + selectedEndpoint + " in FinnGen";
  btn.target = "_blank";
}

// Load endpoints from endpoints.csv and set up the fuzzy search as before.
function loadEndpoints() {
  console.log("loading endpoints csv");
  fetch(window.endpointsCsvUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error("Error fetching endpoints.csv: " + response.status);
      }
      return response.text();
    })
    .then(csvText => {
      let endpoints = [];
      let lines = csvText.split('\n');
      if (lines.length && lines[0].toLowerCase().includes("endpoint")) {
        lines.shift();
      }
      lines.forEach(line => {
        let trimmed = line.trim();
        if (trimmed !== "") endpoints.push(trimmed);
      });
      window.allEndpoints = endpoints;
      let select = document.getElementById('endpoint-select');
      if (select) {
        endpoints.forEach(ep => {
          let option = document.createElement('option');
          option.value = ep;
          option.textContent = ep;
          select.appendChild(option);
        });
        if (endpoints.includes("E4_DIABETES")) {
          select.value = "E4_DIABETES";
        }
      }
      updateFinnGenButton();
    })
    .catch(error => console.error(error));
}

function setupEndpointSearch() {
  let searchInput = document.getElementById('endpoint-search');
  let select = document.getElementById('endpoint-select');
  if (!searchInput || !select || !window.allEndpoints) return;

  searchInput.addEventListener('input', function(e) {
    let query = e.target.value.toLowerCase();
    let filtered = window.allEndpoints.filter(ep =>
      ep.toLowerCase().includes(query)
    );
    select.innerHTML = "";
    filtered.forEach(ep => {
      let option = document.createElement('option');
      option.value = ep;
      option.textContent = ep;
      select.appendChild(option);
    });
    if (filtered.includes("E4_DIABETES")) {
      select.value = "E4_DIABETES";
    } else if (filtered.length > 0) {
      select.value = filtered[0];
    }
    renderFinnGenPlot();
    updateFinnGenButton();
  });
}

document.addEventListener("DOMContentLoaded", function() {
  loadEndpoints();
  setTimeout(setupEndpointSearch, 500);
  renderFinnGenPlot();
  var select = document.getElementById('endpoint-select');
  if (select) {
    select.addEventListener('change', function() {
      renderFinnGenPlot();
      updateFinnGenButton();
    });
  }
});
