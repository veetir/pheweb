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
  var endpointSelect = document.getElementById('endpoint-select');
  var selectedEndpoint = endpointSelect ? endpointSelect.value : "";
  if (!selectedEndpoint) {
    document.getElementById("finngen-gwas-catalog").innerHTML = "<p>Select an endpoint to view associations.</p>";
    updateFinnGenButton();
    return;
  }
  var apiUrl = window.model.urlprefix + "/api/finngen/" + selectedEndpoint + "?region=" + regionData;
  document.getElementById("finngen-gwas-catalog").innerHTML = "<p>Loading...</p>";
  
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
      var x = associations.map(function(record) {
        return record.position;
      });
      var y = associations.map(function(record) {
        return -Math.log10(record.pvalue);
      });
      var customData = associations.map(function(record) {
        return record;
      });

      var sigThreshold = -Math.log10(0.05);
      var gwasThreshold = -Math.log10(5e-8);

      var trace = {
        x: x,
        y: y,
        mode: 'markers',
        type: 'scatter',
        name: selectedEndpoint,
        marker: { color: '#3500D3', opacity: 0.7, size: 8 },
        customdata: customData,
        hovertemplate:
          "<b>%{customdata.rsid}<br></b>" +
          "Nearest Genes: %{customdata.nearest_genes}<br>" +
          "Alt: %{customdata.alt}<br>" +
          "p-value: %{customdata.pvalue}<br>" +
          "mlogp: %{customdata.mlogp}<br>" +
          "Beta: %{customdata.beta}<br>" +
          "SE Beta: %{customdata.sebeta}<br>" +
          "<extra></extra>"
      };

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
        margin: { t: 34, b: 40, l: 50, r: 20 },
        plot_bgcolor: "white",
        height: 500,
        shapes: [
          {
            type: 'line',
            x0: Math.min(...x),
            y0: sigThreshold,
            x1: Math.max(...x),
            y1: sigThreshold,
            line: {
              color: 'grey',
              dash: 'dot',
              width: 2
            }
          },
          {
            type: 'line',
            x0: Math.min(...x),
            y0: gwasThreshold,
            x1: Math.max(...x),
            y1: gwasThreshold,
            line: {
              color: 'grey',
              dash: 'dot',
              width: 2
            }
          }
        ],
        annotations: [
          {
            x: Math.max(...x),
            y: sigThreshold,
            text: "p=0.05",
            showarrow: false,
            xanchor: 'right',
            yanchor: 'top',
            font: { color: 'grey' }
          },
          {
            x: Math.max(...x),
            y: gwasThreshold,
            text: "p=5e-8",
            showarrow: false,
            xanchor: 'right',
            yanchor: 'top',
            font: { color: 'grey' }
          }
        ]
      };
      // Clear existing text if any
      document.getElementById("finngen-gwas-catalog").innerHTML = "";

      // Get the current LocusZoom region (to preserve the existing region)
      var lzStart, lzEnd, lzChr;
      if (window.plot && window.plot.state) {
        lzStart = window.plot.state.start;
        lzEnd   = window.plot.state.end;
        lzChr   = window.plot.state.chr;
      }

      // Render the new FinnGen plot
      Plotly.newPlot('finngen-gwas-catalog', [trace], layout)
        .then(function() {
          var plotDiv = document.getElementById('finngen-gwas-catalog');
          
          // Click event to go to dbSNP page
          plotDiv.on('plotly_click', function(evtData) {
            if (evtData.points && evtData.points.length > 0) {
              var clickedData = evtData.points[0].customdata;
              var rsid = clickedData.rsid;
              if (rsid) {
                var url = "https://www.ncbi.nlm.nih.gov/snp/" + rsid;
                window.open(url, '_blank');
              }
            }
          });

          // Use the existing region from LocusZoom if available
          if (typeof lzStart !== 'undefined' && typeof lzEnd !== 'undefined') {
            Plotly.relayout('finngen-gwas-catalog', {
              'xaxis.range': [lzStart, lzEnd],
              'xaxis.title': 'Chromosome ' + (lzChr || chr) + ' (Mb)'
            });
          }

          // Sync
          if (typeof lzStart !== 'undefined' && typeof lzEnd !== 'undefined') {
            Plotly.relayout('plotly-gwas-catalog', {
              'xaxis.range': [lzStart, lzEnd],
              'xaxis.title': 'Chromosome ' + (lzChr || chr) + ' (Mb)'
            });
          }

          // If a user pans or zooms in the FinnGen chart, update LZ
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

          // LocusZoom->Plotly sync
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

      // Update the FinnGen button link
      updateFinnGenButton();
    })
    .catch(function(error) {
      document.getElementById("finngen-gwas-catalog").innerHTML = "No results for this endpoint in this region " + error.message;
      console.error(error);
    });
}

// Create or update the FinnGen, Risteys, & Endpoint Browser results buttons
function updateFinnGenButton() {
  var endpointSelect = document.getElementById('endpoint-select');
  if (!endpointSelect) return;
  var selectedEndpoint = endpointSelect.value;
  if (!selectedEndpoint || selectedEndpoint.trim() === "") {
    var existing = document.getElementById("finngen-buttons");
    if (existing) {
      existing.remove();
    }
    return;
  }

  // Build the URLs using the selected endpoint
  var finngenUrl = "https://r12.finngen.fi/pheno/" + selectedEndpoint;
  var risteysUrl = "https://risteys.finngen.fi/endpoints/" + selectedEndpoint;
  var endpointBrowserUrl = "https://geneviz.aalto.fi/endpoint_browser_2.0/?view=network&data=" + selectedEndpoint;

  // Construct the common text.
  var commonText = "View " + selectedEndpoint + " in:";

  // Get the container element where the plot is rendered
  var container = document.getElementById("finngen-gwas-catalog");

  // Create or update a container for the common text and buttons
  var btnContainer = document.getElementById("finngen-buttons");
  if (!btnContainer) {
    btnContainer = document.createElement("div");
    btnContainer.id = "finngen-buttons";
    btnContainer.style.marginTop = "10px";
    container.parentNode.insertBefore(btnContainer, container.nextSibling);
  }
  btnContainer.innerHTML = "";

  // Common text
  var commonTextSpan = document.createElement("span");
  commonTextSpan.id = "finngen-common-text";
  commonTextSpan.textContent = commonText + " ";
  btnContainer.appendChild(commonTextSpan);

  // FinnGen button
  var finngenBtn = document.createElement("a");
  finngenBtn.id = "finngen-link";
  finngenBtn.className = "btn";
  finngenBtn.href = finngenUrl;
  finngenBtn.textContent = "FinnGen";
  finngenBtn.title = "View in FinnGen PheWeb";
  finngenBtn.target = "_blank";
  btnContainer.appendChild(finngenBtn);

  // Risteys button
  var risteysBtn = document.createElement("a");
  risteysBtn.id = "risteys-link";
  risteysBtn.className = "btn";
  risteysBtn.href = risteysUrl;
  risteysBtn.textContent = "Risteys";
  risteysBtn.title = "View endpoint definition in Risteys";
  risteysBtn.target = "_blank";
  risteysBtn.style.marginLeft = "10px";
  btnContainer.appendChild(risteysBtn);

  // Endpoint Browser button
  var browserBtn = document.createElement("a");
  browserBtn.id = "endpoint-browser-link";
  browserBtn.className = "btn";
  browserBtn.href = endpointBrowserUrl;
  browserBtn.textContent = "Endpoint Browser";
  browserBtn.title = "Explore Endpoint connections";
  browserBtn.target = "_blank";
  browserBtn.style.marginLeft = "10px";
  btnContainer.appendChild(browserBtn);
}

function updateEndpointLabel(endpointsList) {
  const endpointLabel = document.getElementById('endpoint-select-label');
  const endpointSelect = document.getElementById('endpoint-select');
  if (endpointLabel) {
    const count = endpointsList.length;
    if (count === 0) {
      endpointLabel.textContent = "No endpoints match the search terms.";
      endpointLabel.classList.add("error-label");
      endpointSelect.disabled = true;
    } else {
      endpointLabel.textContent = `${count} matching endpoint${count !== 1 ? "s" : ""}`;
      endpointLabel.classList.remove("error-label");
      endpointSelect.disabled = false;
    }
  }
}


// Load endpoints from endpoints.csv and populate the dropdown
function loadEndpoints() {
  fetch(window.endpointsTsvUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error("Error fetching endpoints.tsv: " + response.status);
      }
      return response.text();
    })
    .then(tsvText => {
      let endpoints = [];
      let lines = tsvText.trim().split('\n');

      if (lines.length === 0) {
        throw new Error("TSV file is empty");
      }

      // Parse the header to find the 'endpoint' and 'phenotype' column indices
      const headers = lines[0].split('\t');
      const endpointIndex = headers.findIndex(h => h.trim().toLowerCase() === 'endpoint');
      const phenotypeIndex = headers.findIndex(h => h.trim().toLowerCase() === 'phenotype');

      if (endpointIndex === -1) {
        throw new Error("No 'endpoint' column found in TSV.");
      }
      if (phenotypeIndex === -1) {
        throw new Error("No 'phenotype' column found in TSV.");
      }

      // Process each line to extract the 'endpoint' and 'phenotype' values
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split('\t');
        if (row.length > endpointIndex && row.length > phenotypeIndex) {
          const endpoint = row[endpointIndex].trim();
          const phenotype = row[phenotypeIndex].trim();
          if (endpoint !== "") {
            endpoints.push({ endpoint, phenotype });
          }
        }
      }

      window.allEndpoints = endpoints;

      // Update the label to show the total count of endpoints
      updateEndpointLabel(endpoints);

      let select = document.getElementById('endpoint-select');
      if (select) {
        select.innerHTML = "";
        let placeholder = document.createElement('option');
        placeholder.value = "";
        placeholder.textContent = "Select an endpoint";
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
        endpoints.forEach(ep => {
          let option = document.createElement('option');
          option.value = ep.endpoint;
          option.textContent = `${ep.endpoint} - ${ep.phenotype}`;
          select.appendChild(option);
        });
      }
      if (typeof setupEndpointSearch === 'function') {
        setupEndpointSearch();
      }
    })
    .catch(error => console.error(error));
}

// Fuzzy search for endpoints
function setupEndpointSearch(retries = 8, delay = 200) {
  let searchInput = document.getElementById('endpoint-search');
  let select = document.getElementById('endpoint-select');
  if (!searchInput || !select || !window.allEndpoints) {
    if (retries > 0) {
      setTimeout(() => setupEndpointSearch(retries - 1, Math.round(delay * 1.2)), delay);
    } else {
      console.warn('setupEndpointSearch: prerequisites not ready after retries');
    }
    return;
  }

  const fuse = new Fuse(window.allEndpoints, {
    keys: ['endpoint', 'phenotype'],
    threshold: 0.4,
    ignoreLocation: true,
  });

  let searchTimeout;
  searchInput.addEventListener('input', function(e) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() {
      let query = e.target.value.trim();
      let filtered;
      if (query === '') {
        filtered = window.allEndpoints;
      } else {
        filtered = fuse.search(query).map(res => res.item);
      }

      updateEndpointLabel(filtered);

      const currentSelection = select.value;

      select.innerHTML = "";
      let placeholder = document.createElement('option');
      placeholder.value = "";
      placeholder.textContent = "Select an endpoint";
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);

      filtered.forEach(ep => {
        let option = document.createElement('option');
        option.value = ep.endpoint;
        option.textContent = `${ep.endpoint} - ${ep.phenotype}`;
        select.appendChild(option);
      });

      if (filtered.some(ep => ep.endpoint === currentSelection)) {
        select.value = currentSelection;
      }
    }, 300);
  });
}

// Initialize everything on DOM load
document.addEventListener("DOMContentLoaded", function() {
  loadEndpoints();
  var select = document.getElementById('endpoint-select');
  if (select) {
    select.addEventListener('change', function() {
      renderFinnGenPlot();
      updateFinnGenButton();
    });
  }
});
