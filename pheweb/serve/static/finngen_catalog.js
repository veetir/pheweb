// FinnGen Catalog Plot Script

// Render the FinnGen plot using GraphQL data.
function renderFinnGenPlot() {
  // Get region info from element with id "lz-1"
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
  var studyId = "FINNGEN_R6_" + selectedEndpoint;

  // Define the GraphQL query.
  var query = `
    query regionalQuery($studyId: String!, $chromosome: String!, $start: Long!, $end: Long!) {
      gwasRegional(studyId: $studyId, chromosome: $chromosome, start: $start, end: $end) {
        variant {
          id
          rsId
          chromosome
          position
          refAllele
          altAllele
        }
        pval
      }
    }
  `;
  var variables = { studyId: studyId, chromosome: chr, start: start, end: end };

  // Fetch data from the Open Targets Genetics GraphQL endpoint.
  fetch('https://api.genetics.opentargets.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query, variables: variables })
  })
    .then(function(response) {
      if (!response.ok) {
        throw new Error("Error fetching FinnGen data: " + response.status);
      }
      return response.json();
    })
    .then(function(data) {
      var associations = data.data.gwasRegional;
      if (!associations || associations.length === 0) {
        document.getElementById("finngen-gwas-catalog").innerHTML = "No associations in this region.";
        // Also update the button since there is no valid phenotype?
        updateFinnGenButton();
        return;
      }

      // Filter associations for the correct region.
      var filtered = associations.filter(function(record) {
        var pos = record.variant.position;
        return record.variant.chromosome === chr && pos >= start && pos <= end;
      });
      if (filtered.length === 0) {
        document.getElementById("finngen-gwas-catalog").innerHTML = "No associations in this region.";
        updateFinnGenButton();
        return;
      }

      // Prepare arrays for Plotly.
      var x = filtered.map(function(record) {
        return record.variant.position;
      });
      var y = filtered.map(function(record) {
        return -Math.log10(record.pval);
      });
      // Custom data for the tooltip (rsid removed).
      var customData = filtered.map(function(record) {
        return {
          id: record.variant.id,
          refAllele: record.variant.refAllele,
          altAllele: record.variant.altAllele,
          pval: record.pval
        };
      });

      // Define the Plotly trace.
      var trace = {
        x: x,
        y: y,
        mode: 'markers',
        type: 'scatter',
        name: selectedEndpoint,
        marker: { color: '#3500D3', opacity: 0.7, size: 8 },
        customdata: customData,
        hovertemplate:
          "<b>ID: %{customdata.id}</b><br>" +
          "Position: %{x}<br>" +
          "-log10 p-value: %{y}<br>" +
          "Alleles: %{customdata.refAllele} > %{customdata.altAllele}<extra></extra>"
      };

      // Mimic the GWAS Catalog plot styling.
      var layout = {
        title: { text: "FinnGen Associations (" + studyId + ")", font: { size: 14 } },
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
        height: 500,
        margin: { t: 34, b: 40, l: 50, r: 20 },
        plot_bgcolor: "white"
      };

        // Clear any previous content (like the "No associations" text)
      document.getElementById("finngen-gwas-catalog").innerHTML = "";

      // Render the plot and then attach the state synchronization.
      Plotly.newPlot('finngen-gwas-catalog', [trace], layout)
        .then(function() {
          // Attach a state_changed listener so that the x-axis stays synced.
          // This assumes that window.plot (from LocusZoom) is available.
          window.plot.on("state_changed", function() {
            var currentState = window.plot.state;
            Plotly.relayout("finngen-gwas-catalog", {
              "xaxis.range": [currentState.start, currentState.end],
              "xaxis.title": "Chromosome " + currentState.chr + " (Mb)"
            });
          });
        });
      // Update the FinnGen button after successfully rendering.
      updateFinnGenButton();
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

  // Try to find an existing button.
  var btn = document.getElementById("finngen-link");
  if (!btn) {
    // Create a new anchor element styled as a button.
    btn = document.createElement("a");
    btn.id = "finngen-link";
    btn.className = "btn"; // You can add additional classes like "btn-primary" if using Bootstrap.
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
      // Update button on endpoints load.
      updateFinnGenButton();
    })
    .catch(error => console.error(error));
}

// Set up fuzzy search for endpoints.
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
    // Re-render the plot and update the button on search change.
    renderFinnGenPlot();
    updateFinnGenButton();
  });
}

// Set up endpoints and event listeners on page load.
document.addEventListener("DOMContentLoaded", function() {
  loadEndpoints();
  // Delay search setup slightly to ensure endpoints are loaded.
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
