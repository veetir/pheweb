function renderD3CatalogPlot() {
  var regionEl = document.getElementById('lz-1');
  if (!regionEl || !regionEl.dataset.region) {
    return;
  }
  var parts = regionEl.dataset.region.split(':');
  var chr = parts[0];
  var coords = parts[1].split('-');
  var start = +coords[0];
  var end = +coords[1];

  var filterStr = "id in 4,7 and chrom eq '" + chr + "' and pos ge " + start + " and pos le " + end;
  var url = "https://portaldev.sph.umich.edu/api/v1/annotation/gwascatalog/results/";
  var params = {
    format: "objects",
    sort: "pos",
    filter: filterStr,
    build: "GRCh38"
  };
  var queryString = Object.keys(params).map(function(k){ return k + "=" + encodeURIComponent(params[k]);}).join("&");
  var fullUrl = url + "?" + queryString;

  fetch(fullUrl).then(function(r){
      if(!r.ok) throw new Error("Error fetching data: " + r.status);
      return r.json();
  }).then(function(data){
      var results = data.data;
      if(!results || !results.length){
          document.getElementById('plotly-gwas-catalog').innerHTML = "No data found in this region.";
          return;
      }

      function getTheme(){
          var styles = getComputedStyle(document.body);
          var bg = styles.getPropertyValue('--bs-body-bg').trim() || 'white';
          var fg = styles.getPropertyValue('--bs-body-color').trim() || 'black';
          var dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
          return {
              bg: bg,
              fg: fg,
              dark: dark,
              ukbb: dark ? '#00C795' : '#008060',
              ebi: dark ? '#FF9470' : '#D33500'
          };
      }
      var theme = getTheme();

      var ukbb = [], gwas = [];
      results.forEach(function(r){
          if (r.pos == null || r.log_pvalue == null) return;
          var rec = {
              pos: +r.pos,
              logp: +r.log_pvalue,
              top_trait: r.trait || "",
              study: r.study || "N/A",
              pmid: r.pmid || "",
              risk_frq: r.risk_frq || "N/A",
              or_beta: r.or_beta || "N/A",
              risk_allele: r.risk_allele || "N/A",
              rsid: r.rsid || "N/A",
              id: r.id
          };
          if (rec.id === 4) ukbb.push(rec); else gwas.push(rec);
      });
      var allData = ukbb.concat(gwas);

      var container = d3.select('#plotly-gwas-catalog');
      container.selectAll('*').remove();

      var margin = {top:20,right:20,bottom:40,left:50};
      var outerWidth = container.node().clientWidth || 800;
      var width = outerWidth - margin.left - margin.right;
      var height = 500 - margin.top - margin.bottom;

      var svg = container.append('svg')
          .attr('width', outerWidth)
          .attr('height', height + margin.top + margin.bottom);
      var g = svg.append('g').attr('transform','translate('+margin.left+','+margin.top+')');

      var xScale = d3.scaleLinear().domain([start,end]).range([0,width]);
      var xScaleOrig = xScale.copy();
      var yMax = d3.max(allData, function(d){ return d.logp;}) || 1;
      var yScale = d3.scaleLinear().domain([0, yMax*1.05]).range([height,0]);

      var xAxis = d3.axisBottom(xScale).tickFormat(function(d){ return (d/1e6).toFixed(2);});
      var yAxis = d3.axisLeft(yScale);

      g.append('clipPath').attr('id','gwasClip')
          .append('rect').attr('width', width).attr('height', height);

      var plotG = g.append('g').attr('clip-path','url(#gwasClip)');

      var ukbbSel = plotG.selectAll('.point.ukbb').data(ukbb).enter().append('circle')
          .attr('class','point ukbb')
          .attr('r',4)
          .attr('cx', function(d){ return xScale(d.pos);})
          .attr('cy', function(d){ return yScale(d.logp);})
          .attr('fill', theme.ukbb)
          .attr('opacity',0.4)
          .on('click', function(event,d){ if(d.pmid){ window.open('https://pubmed.ncbi.nlm.nih.gov/'+d.pmid+'/', '_blank'); }});
      ukbbSel.append('title').text(tooltip);

      var symbol = d3.symbol().type(d3.symbolDiamond).size(64);
      var gwasSel = plotG.selectAll('.point.ebi').data(gwas).enter().append('path')
          .attr('class','point ebi')
          .attr('d', symbol)
          .attr('transform', function(d){ return 'translate(' + xScale(d.pos) + ',' + yScale(d.logp) + ')';})
          .attr('fill', theme.ebi)
          .attr('opacity',0.7)
          .on('click', function(event,d){ if(d.pmid){ window.open('https://pubmed.ncbi.nlm.nih.gov/'+d.pmid+'/', '_blank'); }});
      gwasSel.append('title').text(tooltip);

      g.append('g').attr('class','x axis').attr('transform','translate(0,'+height+')').call(xAxis);
      g.append('g').attr('class','y axis').call(yAxis);

      svg.append('text').attr('class','x label').attr('text-anchor','middle')
          .attr('x', margin.left + width/2)
          .attr('y', height + margin.top + 35)
          .text('Chromosome ' + chr + ' (Mb)');
      svg.append('text').attr('class','y label').attr('text-anchor','middle')
          .attr('transform', 'translate(15,' + (margin.top + height/2) + ') rotate(-90)')
          .text('-log10 p-value');

      function tooltip(d){
          var studyText = d.study === 'UKBB' ? d.study : d.study + (d.pmid ? ' (PMID: '+d.pmid+')' : '');
          return studyText + '\nTop trait: ' + d.top_trait + '\nLog p-value: ' + d.logp +
                 '\nRisk freq: ' + d.risk_frq + '\nEffect size: ' + d.or_beta +
                 '\nRisk allele: ' + d.risk_allele + '\nrsid: ' + d.rsid;
      }

      var zoom = d3.zoom().scaleExtent([1,20])
          .translateExtent([[0,0],[width,height]])
          .extent([[0,0],[width,height]])
          .on('zoom', zoomed)
          .on('end', zoomEnded);
      svg.call(zoom);

      function zoomed(event){
          var newX = event.transform.rescaleX(xScaleOrig);
          xScale.domain(newX.domain());
          g.select('.x.axis').call(xAxis.scale(newX));
          ukbbSel.attr('cx', function(d){ return newX(d.pos);});
          gwasSel.attr('transform', function(d){ return 'translate(' + newX(d.pos) + ',' + yScale(d.logp) + ')';});
          g.selectAll('.trait-label').attr('x', function(d){ return newX(d.pos);});
      }
      function zoomEnded(event){
          var dom = xScale.domain();
          var x0 = Math.floor(dom[0]);
          var x1 = Math.floor(dom[1]);
          if(window.plot && window.plot.state){
              var cur = window.plot.state;
              window.plot.applyState({chr: cur.chr, start: x0, end: x1});
          }
          ['finngen-gwas-catalog','finngen-susie'].forEach(function(id){
              if(window.Plotly && document.getElementById(id)){
                  Plotly.relayout(id, {'xaxis.range':[x0,x1], 'xaxis.title':'Chromosome '+chr+' (Mb)'});
              }
          });
      }

      svg.on('dblclick', function(){
          svg.transition().duration(0).call(zoom.transform, d3.zoomIdentity);
          updateXRange(start, end, chr);
          if(window.plot && window.plot.state){
             window.plot.applyState({chr: chr, start: start, end: end});
          }
          ['finngen-gwas-catalog','finngen-susie'].forEach(function(id){
              if(window.Plotly && document.getElementById(id)){
                  Plotly.relayout(id, {'xaxis.range':[start,end], 'xaxis.title':'Chromosome '+chr+' (Mb)'});
              }
          });
      });

      function updateXRange(newStart, newEnd, newChr){
          chr = newChr || chr;
          xScale.domain([newStart,newEnd]);
          xScaleOrig = xScale.copy();
          g.select('.x.axis').call(xAxis.scale(xScale));
          svg.select('.x.label').text('Chromosome ' + chr + ' (Mb)');
          ukbbSel.attr('cx', function(d){ return xScale(d.pos);});
          gwasSel.attr('transform', function(d){ return 'translate(' + xScale(d.pos) + ',' + yScale(d.logp) + ')';});
          g.selectAll('.trait-label').attr('x', function(d){ return xScale(d.pos);});
      }

      function highlightWord(word){
          plotG.selectAll('.point').classed('highlight', false);
          g.selectAll('.trait-label').remove();
          if(!word) return;
          var lower = word.toLowerCase();
          plotG.selectAll('.point').filter(function(d){ return (d.top_trait||'').toLowerCase().includes(lower); })
            .classed('highlight', true)
            .each(function(d){
                g.append('text').attr('class','trait-label')
                    .attr('x', xScale(d.pos))
                    .attr('y', yScale(d.logp) - 5)
                    .text(d.top_trait)
                    .style('font-size','10px')
                    .style('fill', theme.fg);
            });
      }

      var styleTag = document.createElement('style');
      styleTag.innerHTML = '#plotly-gwas-catalog .point.highlight{stroke:'+theme.fg+';stroke-width:1.5px;opacity:1;}';
      document.head.appendChild(styleTag);

      window.gwasCatalogPlot = {
          setXRange: updateXRange,
          highlightWord: highlightWord
      };

      if(window.plot && window.plot.on){
          window.plot.on('state_changed', function(){
              var s = window.plot.state;
              updateXRange(s.start, s.end, s.chr);
          });
      }

      function applyTheme(){
          theme = getTheme();
          ukbbSel.attr('fill', theme.ukbb);
          gwasSel.attr('fill', theme.ebi);
          svg.style('background-color', theme.bg);
          svg.selectAll('text').style('fill', theme.fg);
          styleTag.innerHTML = '#plotly-gwas-catalog .point.highlight{stroke:'+theme.fg+';stroke-width:1.5px;opacity:1;}';
          g.selectAll('.trait-label').style('fill', theme.fg);
          var map = {ukbb: theme.ukbb, gwas: theme.ebi};
          d3.select('#combined-wordcloud').selectAll('text')
            .style('fill', function(d){ return map[d.dataset] || theme.fg; });
      }
      applyTheme();
      document.addEventListener('pheweb:theme', applyTheme);

      renderCombinedWordCloud(ukbb, gwas, 'combined-wordcloud');

      var combinedWC = document.getElementById('combined-wordcloud');
      if (combinedWC && combinedWC.style.display === 'none') {
          var wcWrapper = document.getElementById('wordclouds');
          if (wcWrapper) wcWrapper.style.display = 'none';
      }
  }).catch(function(err){
      document.getElementById('plotly-gwas-catalog').innerHTML = 'Error loading plot: ' + err.message;
      console.error(err);
  });
}

document.addEventListener('DOMContentLoaded', renderD3CatalogPlot);

const EXTRA_STOPWORDS = new Set([
  'year','years','study','studies',
  'trait','traits','general','self',
  'binding','level','levels','mean'
]);

function renderCombinedWordCloud(ukbbArray, gwasArray, containerId){
    function countWords(arr){
        var wordCounts = {};
        arr.forEach(function(record){
            if(record.top_trait){
                var tokens = (record.top_trait.toLowerCase().match(/[\p{L}\d]+/gu) || []);
                var filtered = tokens;
                if(window.sw && window.sw.removeStopwords){
                    filtered = window.sw.removeStopwords(tokens, window.sw.eng);
                }
                var cleaned = filtered.filter(function(word){
                    return word.length > 2 && !/^\d+$/.test(word) && !EXTRA_STOPWORDS.has(word);
                });
                cleaned.forEach(function(word){
                    wordCounts[word] = (wordCounts[word] || 0) + 1;
                });
            }
        });
        return Object.keys(wordCounts).map(function(word){ return {text: word, count: wordCounts[word]}; })
                      .sort(function(a,b){ return b.count - a.count; });
    }

    var ukbbWords = countWords(ukbbArray).map(function(w){ return Object.assign({}, w, {dataset:'ukbb'});});
    var gwasWords = countWords(gwasArray).map(function(w){ return Object.assign({}, w, {dataset:'gwas'});});

    var targetLength = 50;
    var ukbbCount = Math.floor(targetLength/2);
    var gwasCount = Math.floor(targetLength/2);

    var combined = ukbbWords.slice(0,ukbbCount).concat(gwasWords.slice(0,gwasCount));
    var ukbbIndex = ukbbCount, gwasIndex = gwasCount;
    while(combined.length < targetLength){
        if(ukbbIndex < ukbbWords.length){
            combined.push(ukbbWords[ukbbIndex++]);
        }else if(gwasIndex < gwasWords.length){
            combined.push(gwasWords[gwasIndex++]);
        }else{ break; }
    }
    var container = document.getElementById(containerId);
    if(!combined.length){
        if(container) container.style.display = 'none';
        return;
    } else if(container){ container.style.display=''; }

    var minFont = 18, maxFont = 26;
    var maxCount = d3.max(combined, function(d){ return d.count; });
    var fontSizeScale = d3.scaleLinear().domain([0, Math.log(maxCount+1)]).range([minFont, maxFont]);
    combined.forEach(function(d){ d.size = fontSizeScale(Math.log(d.count+1)); });

    var colorMap = {ukbb: '#008060', gwas: '#D33500'};

    var width = container.clientWidth || 600;
    var height = 100;

    d3.select('#'+containerId).select('svg').remove();

    var layout = d3.layout.cloud()
        .size([width,height])
        .words(combined)
        .padding(4)
        .rotate(function(){ return 0; })
        .fontSize(function(d){ return d.size; })
        .on('end', draw);

    layout.start();

    function draw(words){
        d3.select('#'+containerId).append('svg')
            .attr('width', width)
            .attr('height', height)
          .append('g')
            .attr('transform', 'translate(' + width/2 + ',' + height/2 + ')')
          .selectAll('text')
          .data(words)
          .enter().append('text')
            .attr('class','wordcloud-word')
            .attr('role','button')
            .attr('tabindex',0)
            .style('fill', function(d){ return colorMap[d.dataset] || '#000'; })
            .attr('text-anchor','middle')
            .attr('transform', function(d){ return 'translate(' + [d.x, d.y] + ')rotate(' + d.rotate + ')'; })
            .style('--base-size', function(d){ return d.size + 'px'; })
            .text(function(d){ return d.text; })
            .on('mouseover', function(event, d){
                d3.select(this).classed('is-hovered', true);
                if(window.gwasCatalogPlot && window.gwasCatalogPlot.highlightWord){
                    window.gwasCatalogPlot.highlightWord(d.text);
                }
            })
            .on('mouseout', function(event, d){
                d3.select(this).classed('is-hovered', false);
                if(window.gwasCatalogPlot && window.gwasCatalogPlot.highlightWord){
                    window.gwasCatalogPlot.highlightWord(null);
                }
            })
            .on('click', function(event, d){
                var el = d3.select(this);
                el.classed('is-clicked', true);
                this.addEventListener('animationend', function(){ el.classed('is-clicked', false); }, {once:true});

                var searchBox = document.getElementById('endpoint-search');
                if(searchBox){ searchBox.value = d.text; searchBox.dispatchEvent(new Event('input', {bubbles:true})); }

                var endpointSelect = document.getElementById('endpoint-select');
                if(endpointSelect){
                    endpointSelect.classList.add('highlight-dropdown');
                    clearTimeout(endpointSelect._highlightTimeout);
                    endpointSelect._highlightTimeout = setTimeout(function(){ endpointSelect.classList.remove('highlight-dropdown'); }, 2000);
                }
            })
            .on('keydown', function(){
                var e = d3.event || window.event;
                var key = (e && e.key) || e.keyCode;
                if (key === 'Enter' || key === ' ' || key === 13 || key === 32) {
                    if (e && e.preventDefault) e.preventDefault();
                    this.click();
                }
            });
    }
}

