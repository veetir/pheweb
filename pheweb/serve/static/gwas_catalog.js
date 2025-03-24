function renderPlotlyCatalogPlot() {
    var regionData = document.getElementById('lz-1').dataset.region;
    var parts = regionData.split(':');
    var chr = parts[0];
    var coords = parts[1].split('-');
    var start = coords[0];
    var end = coords[1];
  
    // Build the filter string dynamically using the region values.
    var filterStr = "id in 4,7 and chrom eq '" + chr + "' and pos ge " + start + " and pos le " + end;
    
    // Define the API endpoint and parameters.
    var url = "https://portaldev.sph.umich.edu/api/v1/annotation/gwascatalog/results/";
    var params = {
      format: "objects",
      sort: "pos",
      filter: filterStr,
      build: "GRCh38"
    };
    
    // Construct the URL with encoded parameters.
    var queryString = Object.keys(params).map(function(key) {
      return key + "=" + encodeURIComponent(params[key]);
    }).join("&");
    var fullUrl = url + "?" + queryString;
    
    fetch(fullUrl)
      .then(function(response) {
        if (!response.ok) {
          throw new Error("Error fetching data: " + response.status);
        }
        return response.json();
      })
      .then(function(data) {
        var results = data.data;
        if (!results || results.length === 0) {
          document.getElementById("plotly-gwas-catalog").innerHTML = "No data found in this region.";
          return;
        }
    
        // Prepare arrays for data points for each catalog source.
        var ukbbX = [], ukbbY = [];
        var ebiX = [], ebiY = [];
    
        results.forEach(function(record) {
          var pos = record.pos;
          var logp = record.log_pvalue;
          if (pos != null && logp != null) {
            // Assign catalog source based on catalog id (4 for UKBB)
            if (record.id === 4) {
              ukbbX.push(pos);
              ukbbY.push(logp);
            } else {
              ebiX.push(pos);
              ebiY.push(logp);
            }
          }
        });
    
        // Create trace for UKBB data (circle markers).
        var traceUKBB = {
          x: ukbbX,
          y: ukbbY,
          mode: 'markers',
          type: 'scatter',
          name: 'UKBB',
          marker: { symbol: 'circle', color: '#9632b8', opacity: 0.7 }
        };
    
        // Create trace for EBI data (diamond markers).
        var traceEBI = {
          x: ebiX,
          y: ebiY,
          mode: 'markers',
          type: 'scatter',
          name: 'EBI',
          marker: { symbol: 'diamond', color: '#d43f3a', opacity: 0.7 }
        };
    
        // Define layout (customize titles, axes, etc.).
        var layout = {
          title: { text: "Hits in GWAS Catalog", font: { size: 14 } },
          xaxis: {
            title: "Chromosome " + chr + " (Mb)",
            showgrid: false,
            zeroline: false
          },
          yaxis: {
            title: "-log10 p-value",
            showgrid: false,
            zeroline: false,
            rangemode: "tozero"
          },
          height: 500,
          margin: { t: 20, b: 32, l: 50, r: 20 },
          plot_bgcolor: "white"
        };
    
        // Render the plot in the designated div.
        Plotly.newPlot('plotly-gwas-catalog', [traceUKBB, traceEBI], layout);
      })
      .catch(function(error) {
        document.getElementById("plotly-gwas-catalog").innerHTML = "Error loading plot: " + error.message;
        console.error(error);
      });
  }
    
  // Call the function after the page loads.
  document.addEventListener("DOMContentLoaded", renderPlotlyCatalogPlot);
  