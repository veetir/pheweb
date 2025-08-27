function renderPlotlyCatalogPlot() {
  var regionData = document.getElementById('lz-1').dataset.region;
  var parts = regionData.split(':');
  var chr = parts[0];
  var coords = parts[1].split('-');
  var start = coords[0];
  var end = coords[1];

  // Build the filter string dynamically using the region values
  var filterStr = "id in 4,7 and chrom eq '" + chr + "' and pos ge " + start + " and pos le " + end;

  // Define the API endpoint and parameters
  var url = "https://portaldev.sph.umich.edu/api/v1/annotation/gwascatalog/results/";
  var params = {
    format: "objects",
    sort: "pos",
    filter: filterStr,
    build: "GRCh38"
  };

  // Construct the URL with encoded parameters
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

      // Arrays for UKBB trace
      var ukbbX = [], ukbbY = [], ukbbCustom = [];
      // Arrays for EBI trace
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
            
          // If no whitespace is found before width, look forward
          if (breakIndex === -1) {
            breakIndex = text.indexOf(' ', width);
            // If there's still no whitespace, break at the end of the string
            if (breakIndex === -1) {
              breakIndex = text.length;
            }
          }
            
          // Append the current segment and trim any leading spaces from the rest
          result += text.substring(0, breakIndex) + "<br>";
          text = text.substring(breakIndex).trim();
        }
          
        // Append any remaining text
        result += text;
        return result;
      }

      // Define a hovertemplate that mimics the LocusZoom tooltip
      var tooltipTemplate =
        "<b>%{customdata.studyText}</b><br>" +
        "<b>Top trait:</b> %{customdata.trait}<br>" +
        "<b>Log p-value:</b> %{y}<br>" +
        "<b>Risk freq:</b> %{customdata.risk_frq}<br>" +
        "<b>Effect size:</b> %{customdata.or_beta}<br>" +
        "<b>Risk allele:</b> %{customdata.risk_allele}<br>" +
        "<b>rsid:</b> %{customdata.rsid}<extra></extra>";

      // Create trace for UKBB data (circle markers)
      var traceUKBB = {
        x: ukbbX,
        y: ukbbY,
        mode: 'markers',
        type: 'scatter',
        name: 'UKBB',
        marker: { symbol: 'circle', color: '#008060', opacity: 0.4, size: 8 },
        customdata: ukbbCustom,
        hovertemplate: tooltipTemplate
      };

      // Create trace for EBI data (diamond markers)
      var traceEBI = {
        x: ebiX,
        y: ebiY,
        mode: 'markers',
        type: 'scatter',
        name: 'GWAS Catalog',
        marker: { symbol: 'diamond', color: '#D33500', opacity: 0.7, size: 8 },
        customdata: ebiCustom,
        hovertemplate: tooltipTemplate
      };

      // Define layout
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
        plot_bgcolor: "white",
        legend: {
          orientation: "h",
          xanchor: "center",
          x: 0.5,
          y: -0.3
        }
      };

      const EXTRA_STOPWORDS = new Set([
        'year', 'years', 'study', 'studies',
        'trait', 'traits', 'general', 'self',
        'binding', 'level', 'levels', 'mean',
      ]);

      function renderCombinedWordCloud(ukbbArray, gwasArray, containerId) {
        function countWords(customArray) {
          const wordCounts = {};
          customArray.forEach(record => {
            if (record.trait) {
              const tokens = (record.trait.toLowerCase().match(/[\p{L}\d]+/gu) || []);
              let filtered = tokens;
              if (window.sw && window.sw.removeStopwords) {
                filtered = window.sw.removeStopwords(tokens, window.sw.eng);
              }
              const cleaned = filtered.filter(word =>
                word.length > 2 &&
                !/^\d+$/.test(word) &&
                !EXTRA_STOPWORDS.has(word)
              );
              cleaned.forEach(word => {
                wordCounts[word] = (wordCounts[word] || 0) + 1;
              });
            }
          });
          return Object.keys(wordCounts).map(word => ({ text: word, count: wordCounts[word] }))
                              .sort((a, b) => b.count - a.count);
        }

        let ukbbWords = countWords(ukbbArray).map(w => ({ ...w, dataset: 'ukbb' }));
        let gwasWords = countWords(gwasArray).map(w => ({ ...w, dataset: 'gwas' }));

        const targetLength = 50;  

        // Split the target length roughly in half between ukbb and gwas
        const ukbbCount = Math.floor(targetLength / 2);
        const gwasCount = Math.floor(targetLength / 2);

        let combined = ukbbWords.slice(0, ukbbCount).concat(gwasWords.slice(0, gwasCount));
        let ukbbIndex = ukbbCount;
        let gwasIndex = gwasCount;

        while (combined.length < targetLength) {
          if (ukbbCount < Math.floor(targetLength / 2) && gwasIndex < gwasWords.length) {
            combined.push(gwasWords[gwasIndex++]);
          } else if (gwasCount < Math.floor(targetLength / 2) && ukbbIndex < ukbbWords.length) {
            combined.push(ukbbWords[ukbbIndex++]);
          } else {
            break;
          }
}
        const container = document.getElementById(containerId);
        if (!combined.length) {
          if (container) {
            container.style.display = 'none';
          }
          return;
        } else if (container) {
          container.style.display = '';
        }

        const minFont = 16;
        const maxFont = 26;
        const maxCount = d3.max(combined, d => d.count);
        const fontSizeScale = d3.scaleLinear()
                                .domain([0, Math.log(maxCount + 1)])
                                .range([minFont, maxFont]);

        combined.forEach(d => {
          d.size = fontSizeScale(Math.log(d.count + 1));
        });

        const colorMap = { ukbb: '#006149', gwas: '#A82A00' };

        const width = container.clientWidth || 600;
        const height = 100;

        d3.select('#' + containerId).select('svg').remove();

        const layout = d3.layout.cloud()
            .size([width, height])
            .words(combined)
            .padding(4)
            .rotate(() => 0)
            .fontSize(d => d.size)
            .on('end', draw);

        layout.start();

        function draw(words) {
          d3.select('#' + containerId).append('svg')
              .attr('width', width)
              .attr('height', height)
            .append('g')
              .attr('transform', 'translate(' + width / 2 + ',' + height / 2 + ')')
            .selectAll('text')
            .data(words)
            .enter().append('text')
              .attr('class', 'wordcloud-word')
              .attr('role', 'button')
              .attr('tabindex', 0)
              .style('fill', d => colorMap[d.dataset] || '#000')
              .attr('text-anchor', 'middle')
              .attr('transform', d => 'translate(' + [d.x, d.y] + ')rotate(' + d.rotate + ')')
              .style('--base-size', d => d.size + 'px')
              .text(d => d.text)
              .on('mouseover', function() { d3.select(this).classed('is-hovered', true); })
              .on('mouseout',  function() { d3.select(this).classed('is-hovered', false); })
              .on('click', function() {
                const el = d3.select(this);
                const d = el.datum();

                el.classed('is-clicked', true);
                this.addEventListener('animationend', () => el.classed('is-clicked', false), { once: true });

                const searchBox = document.getElementById('endpoint-search');
                searchBox.value = d.text;
                searchBox.dispatchEvent(new Event('input', { bubbles: true }));

                const endpointSelect = document.getElementById('endpoint-select');
                if (endpointSelect) {
                  endpointSelect.classList.add('highlight-dropdown');
                  clearTimeout(endpointSelect._highlightTimeout);
                  endpointSelect._highlightTimeout = setTimeout(() => {
                    endpointSelect.classList.remove('highlight-dropdown');
                  }, 2000);
                }
              })
              .on('keydown', function() {
                const e = d3.event || window.event;
                const key = (e && e.key) || e.keyCode;
                if (key === 'Enter' || key === ' ' || key === 13 || key === 32) {
                  if (e && e.preventDefault) e.preventDefault();
                  this.click();
                }
              });
        }
      }
      
      // Render the Plotly plot
      Plotly.newPlot('plotly-gwas-catalog', [traceUKBB, traceEBI], layout)
        .then(function() {
          // Attach a click event listener so that clicking a point opens the PubMed page
          var plotDiv = document.getElementById('plotly-gwas-catalog');

          // Clicking a point opens PubMed page
          plotDiv.on('plotly_click', function(data) {
            var point = data.points[0];
            var custom = point.customdata;
            if (custom.pmid) {
              var pubmedUrl = "https://pubmed.ncbi.nlm.nih.gov/" + custom.pmid + "/";
              window.open(pubmedUrl, "_blank");
            }
          });

          // Listen for user panning/zooming in Plotly => update LocusZoom + FinnGen
          plotDiv.on('plotly_relayout', function(evtData) {
            var xStart = evtData['xaxis.range[0]'];
            var xEnd   = evtData['xaxis.range[1]'];

            // Only proceed if x-range actually changed
            if (typeof xStart !== 'undefined' && typeof xEnd !== 'undefined') {
              // 1. Update the LocusZoom region
              if (window.plot && window.plot.state) {
                var currentState = window.plot.state;
                window.plot.applyState({
                  chr: currentState.chr,
                  start: Math.floor(xStart),
                  end: Math.floor(xEnd)
                });
              }

              // 2. Also update the FinnGen chart
              Plotly.relayout('finngen-gwas-catalog', {
                'xaxis.range': [xStart, xEnd],
                'xaxis.title': "Chromosome " + chr + " (Mb)"
              });
            }
          });
            renderCombinedWordCloud(ukbbCustom, ebiCustom, 'combined-wordcloud');

            const combinedWC = document.getElementById('combined-wordcloud');
            if (combinedWC && combinedWC.style.display === 'none') {
              const wcWrapper = document.getElementById('wordclouds');
              if (wcWrapper) {
                wcWrapper.style.display = 'none';
              }
            }
          });
    })
    .catch(function(error) {
      document.getElementById("plotly-gwas-catalog").innerHTML = "Error loading plot: " + error.message;
      console.error(error);
    });
}

// Call the function after the DOM is ready
document.addEventListener("DOMContentLoaded", renderPlotlyCatalogPlot);
