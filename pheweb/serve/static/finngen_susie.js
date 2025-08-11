function csColour(row) {
  return row.good_cs ? '#1f77b4' : '#aec7e8';
}

function isDrug(row) {
  return row.trait.startsWith('ATC_');
}

function classifyRow(row) {
  return 'endpoint_' + (row.good_cs ? 'good' : 'low');
}

function renderFinnGenSusie() {
  var regionEl = document.getElementById('lz-1');
  if (!regionEl || !regionEl.dataset.region) {
    console.error("No region data found on element with id 'lz-1'");
    return;
  }
  var region = regionEl.dataset.region;
  var apiUrl = window.model.urlprefix + '/api/finngen-susie?region=chr' + region;
  var container = document.getElementById('finngen-susie');
  if (!container) return;
  container.innerHTML = '<p>Loading...</p>';

  fetch(apiUrl)
    .then(function(response) {
      if (!response.ok) throw new Error("Failed to fetch SuSiE data");
      return response.json();
    })
    .then(function(json) {
      var rows = json.data || json;
      var showEP = document.getElementById('show-endpoints').checked;
      var showDG = document.getElementById('show-drugs').checked;
      var showLQ = document.getElementById('show-low-quality').checked;

      rows = rows.filter(function(r) {
        return isDrug(r) ? showDG : showEP;
      });
      if (!showLQ) {
        rows = rows.filter(function(r){
          return r.good_cs;
        });
      }

      if (!rows || !rows.length) {
        container.innerHTML = 'No SuSiE results in this region.';
        return;
      }

      // Group identical credible-set intervals per endpoint and quality
      var grouped = {};
      rows.forEach(function(r){
        var key = [r.trait, r.start, r.end, r.good_cs].join('|');
        if (!grouped[key]) {
          grouped[key] = {
            trait: r.trait,
            start: r.start,
            end: r.end,
            good_cs: r.good_cs,
            cs: [],
            vpos: [],
            variant: [],
            prob: []
          };
        }
        grouped[key].cs.push(r.cs);
        grouped[key].vpos.push(r.vpos);
        grouped[key].variant.push(r.variant);
        grouped[key].prob.push(r.prob);
      });
      rows = Object.values(grouped);

      // Build y-axis labels
      var labels = [];
      rows.forEach(function(r) {
        if (r.cs.length>1) {
           var lab = r.trait + ' (' + (r.cs.length>1 ? ' ×' + r.cs.length : '') + ')';
        } else {
          var lab = r.trait;
        }
        r.label = lab;
        if (labels.indexOf(lab) === -1) labels.push(lab);
      });
      var yIndex = {};
      labels.forEach(function(l, i) { yIndex[l] = i + 1; });

      // Bucket data by good/low endpoint quality
      var categories = {
        endpoint_good: { lineX:[], lineY:[], markerX:[], markerY:[], markerSize:[], color: csColour({good_cs:true}),  name: 'Credible set' },
        endpoint_low:  { lineX:[], lineY:[], markerX:[], markerY:[], markerSize:[], color: csColour({good_cs:false}), name: 'Credible set (low quality)' }
      };
      var shapes = [];

      rows.forEach(function(r) {
        var lab    = r.label;
        var y      = yIndex[lab];
        var bucket = categories[classifyRow(r)];

        // credible‐set interval
        bucket.lineX.push(r.start, r.end, null);
        bucket.lineY.push(y,      y,     null);

        // endpoint marker(s)
        r.vpos.forEach(function(vpos, idx){
          bucket.markerX.push(vpos);
          bucket.markerY.push(y);
          bucket.markerSize.push((r.prob[idx]||0)*20 + 5);

          // little guide-line at the row (yref:'y')
          shapes.push({
            type: 'line',
            x0: vpos, x1: vpos,
            yref: 'y',  y0: y,   y1: y,
            line: { color: bucket.color, width: 1, dash: 'dot' }
          });
        });
      });

      // Assemble traces
      var traces = [];

      // 1) credible‐set bars + 2) endpoint markers (no hover)
      Object.keys(categories).forEach(function(key){
        var c = categories[key];
        // bars
        traces.push({
          x: c.lineX,
          y: c.lineY,
          mode: 'lines',
          line: { color: c.color, width: 4 },
          hoverinfo: 'skip',
          name: c.name,
          legendgroup: key,
          showlegend: true
        });
      });

      // 3) top‐variant crosses in dark red, hover shows variant string
      var variantX = [], variantY = [], variantText = [];
      rows.forEach(function(r){
        var lab = r.label;
        r.vpos.forEach(function(vpos, idx){
          variantX.push(vpos);
          variantY.push(yIndex[lab]);
          variantText.push(r.variant[idx]);
        });
      });
      traces.push({
        x: variantX,
        y: variantY,
        mode: 'markers',
        marker: { symbol: 'x', size: 10, color: '#D62728' },
        name: 'Top variant',
        text: variantText,
        hoverinfo: 'text',
        showlegend: true
      });

      // Layout
      var chr = region.split(':')[0];
      var layout = {
        showlegend: true,
        xaxis:      {
          title: 'Chromosome ' + chr + ' position',
          showgrid: false,
          zeroline: true,
          zerolinecolor: 'black'
        },
        yaxis: {
          tickvals:  labels.map((_,i)=>i+1),
          ticktext:  labels,
          showgrid:  false,
          autorange: 'reversed'
        },
        margin:     { t:34, b:40, l:120, r:20 },
        height:     200 + 25*labels.length,
        shapes:     shapes,
        legend: {
            orientation: 'h',
            x: 0,
            y: 1,
            xanchor: 'left',  
            yanchor: 'bottom'
        },
        plot_bgcolor: 'white'
      };

        var endpoints = labels.map(function(l) {
        return l.replace(/\s*\(.*\)$/, '');
        });
        var uniqueEndpoints = Array.from(new Set(endpoints));
        var summaryEl = document.getElementById('susie-summary');
        var controlsEl = document.getElementById('susie-controls');
        var lzWidth = document.getElementById('lz-1').clientWidth;
        summaryEl.style.maxWidth = lzWidth + 'px';
        summaryEl.style.margin = '0 auto';
        if (controlsEl) {
          controlsEl.style.maxWidth = lzWidth + 'px';
          controlsEl.style.margin = '0 auto';
        }
        var count = uniqueEndpoints.length;
        summaryEl.innerHTML =
          '<strong>' + count + '</strong> overlapping endpoint' + (count===1?'':'s') +
          ' <a href="#" class="info-link" title="Endpoints '
          + 'whose credible-sets overlap the current region"><img src="' +
          window.model.urlprefix + '/static/images/info.svg" class="info-icon info-icon-inline info-icon-inline-lg"'
          + ' alt="Info"></a>: ';


        uniqueEndpoints.forEach(function(ep) {
        // decide URL
        var href;
        var m = ep.match(/^ATC_(.+)_IRN$/);
        if (m) {
            // drug
            var code = m[1];
            href = 'https://atcddd.fhi.no/atc_ddd_index/?code=' + encodeURIComponent(code);
        } else {
            // non‐drug endpoint
            href = 'https://results.finngen.fi/pheno/' + encodeURIComponent(ep);
        }

        // build the “pill” as a link
        var a = document.createElement('a');
        a.href        = href;
        a.target      = '_blank';
        a.textContent = ep;
        a.className = 'btn susie-pill';

        summaryEl.appendChild(a);
        });

      // Render
      container.innerHTML = '';
      var plotDiv = document.getElementById('finngen-susie');
      plotDiv.style.maxWidth = lzWidth + 'px';
      plotDiv.style.margin = '0 auto';
      layout.width = lzWidth;
      Plotly.newPlot(plotDiv, traces, layout, {responsive: true}).then(function(){
        // sync with locuszoom state...
        if (window.plot && window.plot.state) {
          var s = window.plot.state;
          Plotly.relayout('finngen-susie',{
            'xaxis.range': [s.start, s.end],
            'xaxis.title': 'Chromosome ' + (s.chr||chr) + ' position'
          });
        }
        var pd = document.getElementById('finngen-susie');
        pd.on('plotly_relayout', function(evt){
          var x0 = evt['xaxis.range[0]'], x1 = evt['xaxis.range[1]'];
          if (x0!=null && x1!=null && window.plot && window.plot.applyState) {
            var cur = window.plot.state;
            window.plot.applyState({
              chr: cur.chr,
              start: Math.floor(x0),
              end:   Math.floor(x1)
            });
            // propagate to the other panels
            ['finngen-gwas-catalog','plotly-gwas-catalog'].forEach(function(id){
              Plotly.relayout(id, {
                'xaxis.range': [x0, x1],
                'xaxis.title': 'Chromosome ' + (cur.chr||chr) + ' (Mb)'
              });
            });
          }
        });
        if (window.plot && window.plot.on) {
          window.plot.on('state_changed', function(){
            var s = window.plot.state;
            Plotly.relayout('finngen-susie',{
              'xaxis.range': [s.start, s.end],
              'xaxis.title': 'Chromosome ' + s.chr + ' position'
            });
          });
        }
        window.addEventListener('resize', function(){
          var newWidth = document.getElementById('lz-1').clientWidth;
          Plotly.relayout(plotDiv, {width: newWidth});
          summaryEl.style.maxWidth = newWidth + 'px';
          if (controlsEl) controlsEl.style.maxWidth = newWidth + 'px';
          plotDiv.style.maxWidth = newWidth + 'px';
        });
      });
    })
    .catch(function(err){
      container.innerHTML = 'No SuSiE results in this region.';
      console.error(err);
    });
}

document.addEventListener('DOMContentLoaded', function(){
  renderFinnGenSusie();

  var sel      = document.getElementById('endpoint-select');
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');

  var summary = document.getElementById('susie-summary');
  if (summary) {
    summary.addEventListener('wheel', function(e) {
      if (e.deltaY === 0) return;
      e.preventDefault();
      summary.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  if (sel)      sel.addEventListener('change', renderFinnGenSusie);
  if (epToggle) epToggle.addEventListener('change', renderFinnGenSusie);
  if (dgToggle) dgToggle.addEventListener('change', renderFinnGenSusie);
  if (lqToggle) lqToggle.addEventListener('change', renderFinnGenSusie);
});

