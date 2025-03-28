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
    
        // Arrays for UKBB trace.
        var ukbbX = [], ukbbY = [], ukbbCustom = [];
        // Arrays for EBI trace.
        var ebiX = [], ebiY = [], ebiCustom = [];
    
        results.forEach(function(record) {
            var pos = record.pos;
            var logp = record.log_pvalue;
            if (pos != null && logp != null) {
              // Gather extra fields for the tooltip.
              var extra = {
                study: record.study || "N/A",
                pmid: record.pmid || "",
                trait: record.trait || "N/A",
                risk_frq: record.risk_frq || "N/A",
                or_beta: record.or_beta || "N/A",
                risk_allele: record.risk_allele || "N/A",
                rsid: record.rsid || "N/A"
              };
              // If study is UKBB, don't include the PMID.
              if (extra.study === "UKBB") {
                extra.studyText = wrapText(extra.study, 60);
              } else {
                extra.studyText = wrapText(extra.study + " (PMID: " + extra.pmid + ")", 60);
              }
          
              // Based on the catalog id (4 for UKBB), add to the appropriate arrays.
              if (record.id === 4) {
                ukbbX.push(pos);
                ukbbY.push(logp);
                ukbbCustom.push(extra);
              } else {
                ebiX.push(pos);
                ebiY.push(logp);
                ebiCustom.push(extra);
              }
            }
        });

        function wrapText(text, width) {
          let result = '';
          
          while (text.length > width) {
            // Look for the last whitespace before the width limit.
            let breakIndex = text.lastIndexOf(' ', width);
            
            // If no whitespace is found before width, look forward.
            if (breakIndex === -1) {
              breakIndex = text.indexOf(' ', width);
              // If there's still no whitespace, break at the end of the string.
              if (breakIndex === -1) {
                breakIndex = text.length;
              }
            }
            
            // Append the current segment and trim any leading spaces from the rest.
            result += text.substring(0, breakIndex) + "<br>";
            text = text.substring(breakIndex).trim();
          }
          
          // Append any remaining text.
          result += text;
          return result;
        }

        // Define a hovertemplate that mimics the LocusZoom tooltip.
        var tooltipTemplate = 
            "<b>%{customdata.studyText}</b><br>" +
            "<b>Top trait:</b> %{customdata.trait}<br>" +
            "<b>Log p-value:</b> %{y}<br>" +
            "<b>Risk freq:</b> %{customdata.risk_frq}<br>" +
            "<b>Effect size:</b> %{customdata.or_beta}<br>" +
            "<b>Risk allele:</b> %{customdata.risk_allele}<br>" +
            "<b>rsid:</b> %{customdata.rsid}<extra></extra>";

        // Create trace for UKBB data (circle markers).
        var traceUKBB = {
          x: ukbbX,
          y: ukbbY,
          mode: 'markers',
          type: 'scatter',
          name: 'UKBB',
          marker: { symbol: 'circle', color: '#9632b8', opacity: 0.6, size: 8 },
          customdata: ukbbCustom,
          hovertemplate: tooltipTemplate
        };
    
        // Create trace for EBI data (diamond markers).
        var traceEBI = {
          x: ebiX,
          y: ebiY,
          mode: 'markers',
          type: 'scatter',
          name: 'GWAS Catalog',
          marker: { symbol: 'diamond', color: '#d43f3a', opacity: 0.6, size: 8 },
          customdata: ebiCustom,
          hovertemplate: tooltipTemplate
        };
    
        // Define layout.
        var layout = {
          title: { text: "Hits in GWAS Catalog", font: { size: 14 } },
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
            title: "-log10 p-value",
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
    
        // Render the Plotly plot.
        Plotly.newPlot('plotly-gwas-catalog', [traceUKBB, traceEBI], layout)
          .then(function() {
            // Attach a click event listener so that clicking a point opens the PubMed page.
            var plotDiv = document.getElementById('plotly-gwas-catalog');
            plotDiv.on('plotly_click', function(data) {
              var point = data.points[0];
              var custom = point.customdata;
              if (custom.pmid) {
                var pubmedUrl = "https://pubmed.ncbi.nlm.nih.gov/" + custom.pmid + "/";
                window.open(pubmedUrl, "_blank");
              }
            });
          });
      })
      .catch(function(error) {
        document.getElementById("plotly-gwas-catalog").innerHTML = "Error loading plot: " + error.message;
        console.error(error);
      });
  }
    
  // Call the function after the page loads.
  document.addEventListener("DOMContentLoaded", renderPlotlyCatalogPlot);
  