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
        throw new Error();
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
        return record.pos;
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
          "<b>%{customdata.rsids}<br></b>" +
          "Nearest Genes: %{customdata.nearest_genes}<br>" +
          "Alt: %{customdata.alt}<br>" +
          "p-value: %{customdata.pval}<br>" +
          "mlogp: %{customdata.mlogp}<br>" +
          "Beta: %{customdata.beta}<br>" +
          "SE Beta: %{customdata.sebeta}<br>" +
          "AF alt: %{customdata.af_alt}<br>" +
          "AF alt cases: %{customdata.af_alt_cases}<br>" +
          "AF alt controls: %{customdata.af_alt_controls}<br>" +
          "<extra></extra>"
      };      

      // A matching layout for consistent x-axis alignment
      var layout = {
        title: { text: "FinnGen Associations (" + selectedEndpoint + ")", font: { size: 14 } },
        showlegend: false,
        xaxis: {
          domain: [0, 1],
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
        // Match margins so it lines up with the other plot
        margin: { t: 34, b: 40, l: 50, r: 20 },
        plot_bgcolor: "white",
        height: 500
      };

      // Clear existing text if any
      document.getElementById("finngen-gwas-catalog").innerHTML = "";

      // 1) Get the current LocusZoom region (to preserve the existing region)
      var lzStart, lzEnd, lzChr;
      if (window.plot && window.plot.state) {
        lzStart = window.plot.state.start;
        lzEnd   = window.plot.state.end;
        lzChr   = window.plot.state.chr;
      }

      // 2) Render the new FinnGen plot
      Plotly.newPlot('finngen-gwas-catalog', [trace], layout)
        .then(function() {
          var plotDiv = document.getElementById('finngen-gwas-catalog');

          // 3) Force the new chart to use the existing region from LocusZoom
          //    (if available; otherwise it just uses the layout defaults)
          if (typeof lzStart !== 'undefined' && typeof lzEnd !== 'undefined') {
            Plotly.relayout('finngen-gwas-catalog', {
              'xaxis.range': [lzStart, lzEnd],
              // If you want to also use the LZ chromosome, update the axis title:
              'xaxis.title': 'Chromosome ' + (lzChr || chr) + ' (Mb)'
            });
          }

          // 4) Because we are programmatically relayout-ing, no "plotly_relayout" event fires
          //    So we also manually sync the other chart to the same region
          if (typeof lzStart !== 'undefined' && typeof lzEnd !== 'undefined') {
            Plotly.relayout('plotly-gwas-catalog', {
              'xaxis.range': [lzStart, lzEnd],
              'xaxis.title': 'Chromosome ' + (lzChr || chr) + ' (Mb)'
            });
          }

          // 5) (Optional) Attach user-based sync events
          //    If a user pans or zooms in the FinnGen chart, update LZ
          plotDiv.on('plotly_relayout', function(evtData) {
            var xStart = evtData['xaxis.range[0]'];
            var xEnd   = evtData['xaxis.range[1]'];
            if (typeof xStart !== 'undefined' && typeof xEnd !== 'undefined') {
              // Update LocusZoom
              if (window.plot && window.plot.state) {
                var currentState = window.plot.state;
                window.plot.applyState({
                  chr: currentState.chr,
                  start: Math.floor(xStart),
                  end: Math.floor(xEnd)
                });
              }
              // Update the other Plotly chart
              Plotly.relayout('plotly-gwas-catalog', {
                'xaxis.range': [xStart, xEnd],
                'xaxis.title': 'Chromosome ' + (lzChr || chr) + ' (Mb)'
              });
            }
          });

          // 6) Also attach LocusZoom->Plotly sync if needed
          if (window.plot && window.plot.on) {
            window.plot.on('state_changed', function() {
              var currentState = window.plot.state;
              Plotly.relayout('finngen-gwas-catalog', {
                'xaxis.range': [currentState.start, currentState.end],
                'xaxis.title': 'Chromosome ' + currentState.chr + ' (Mb)'
              });
            });
          }
        });

      // Finally, update the FinnGen button link
          updateFinnGenButton();
    })
    .catch(function(error) {
      document.getElementById("finngen-gwas-catalog").innerHTML = "No results for this endpoint in this region " + error.message;
      console.error(error);
    });
}

// Create or update the FinnGen results button.
function updateFinnGenButton() {
  var endpointSelect = document.getElementById('endpoint-select');
  if (!endpointSelect) return;
  var selectedEndpoint = endpointSelect.value;
  var finngenUrl = "https://results.finngen.fi/pheno/" + selectedEndpoint;

  // Try to find an existing button.
  var btn = document.getElementById("finngen-link");
  if (!btn) {
    // Create a new anchor element styled as a button.
    btn = document.createElement("a");
    btn.id = "finngen-link";
    btn.className = "btn";
    btn.style.marginTop = "10px";
    btn.style.display = "inline-block";
    // Insert the button after the FinnGen plot container.
    var container = document.getElementById("finngen-gwas-catalog");
    container.parentNode.insertBefore(btn, container.nextSibling);
  }
  // Update the button's attributes.
  btn.href = finngenUrl;
  btn.textContent = "View " + selectedEndpoint + " in FinnGen";
  btn.target = "_blank"; // Opens the link in a new tab.
}

function updateEndpointLabel(endpointsList) {
  const endpointLabel = document.getElementById('endpoint-select-label');
  if (endpointLabel) {
    const count = endpointsList.length;
    endpointLabel.textContent = `Select out of ${count} endpoint${count !== 1 ? "s" : ""}`;
  }
}

// Load endpoints from endpoints.csv and populate the dropdown.
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
      // Remove header if present.
      if (lines.length && lines[0].toLowerCase().includes("endpoint")) {
        lines.shift();
      }
      lines.forEach(line => {
        let trimmed = line.trim();
        if (trimmed !== "") endpoints.push(trimmed);
      });
      window.allEndpoints = endpoints;
    
      // Update the label to show the total count of endpoints.
      updateEndpointLabel(endpoints);
    
      let select = document.getElementById('endpoint-select');
      if (select) {
        endpoints.forEach(ep => {
          let option = document.createElement('option');
          option.value = ep;
          option.textContent = ep;
          select.appendChild(option);
        });
        // Optionally choose a default
        if (endpoints.includes("E4_DIABETES")) {
          select.value = "E4_DIABETES";
        }
      }
      updateFinnGenButton();
    })
    .catch(error => console.error(error));
}

// Set up fuzzy search for endpoints.
function setupEndpointSearch() {
  let searchInput = document.getElementById('endpoint-search');
  let select = document.getElementById('endpoint-select');
  if (!searchInput || !select || !window.allEndpoints) return;

  // Helper function to normalize a term.
  function normalizeTerm(term) {
    return term
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/_/g, '') // remove underscores
      .replace(/s$/, '') // strip trailing plural 's'
      .trim();
  }

  searchInput.addEventListener('input', function(e) {
    let query = normalizeTerm(e.target.value);
    let filtered = window.allEndpoints.filter(ep => {
      let normEp = normalizeTerm(ep);
      return normEp.includes(query) || query.includes(normEp);
    });
    
    updateEndpointLabel(filtered);
    
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
    // Re-render the plot with the newly selected endpoint.
    renderFinnGenPlot();
    updateFinnGenButton();
  });
}

// Initialize everything on DOM load
document.addEventListener("DOMContentLoaded", function() {
  loadEndpoints();
  // Delay the fuzzy search setup slightly, if needed
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
