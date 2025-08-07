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

    rows = rows.filter(function(r) {
    return isDrug(r) ? showDG
                    : showEP;
    });

      if (!rows || !rows.length) {
        container.innerHTML = 'No SuSiE results in this region.';
        return;
      }

      // Build y-axis labels
      var labels = [];
      rows.forEach(function(r) {
        var lab = r.trait + ' (' + r.cs + ')';
        if (labels.indexOf(lab) === -1) labels.push(lab);
      });
      var yIndex = {};
      labels.forEach(function(l, i) { yIndex[l] = i + 1; });

      // Bucket data by good/low endpoint quality
      var categories = {
        endpoint_good: { lineX:[], lineY:[], markerX:[], markerY:[], markerSize:[], color: csColour({good_cs:true}),  name: 'Endpoint (good)' },
        endpoint_low:  { lineX:[], lineY:[], markerX:[], markerY:[], markerSize:[], color: csColour({good_cs:false}), name: 'Endpoint (low quality)' }
      };
      var shapes = [];

      rows.forEach(function(r) {
        var lab    = r.trait + ' (' + r.cs + ')';
        var y      = yIndex[lab];
        var bucket = categories[classifyRow(r)];

        // credible‐set interval
        bucket.lineX.push(r.start, r.end, null);
        bucket.lineY.push(y,      y,     null);

        // endpoint marker
        bucket.markerX.push(r.vpos);
        bucket.markerY.push(y);
        bucket.markerSize.push((r.prob||0)*20 + 5);

        // little guide-line at the row (yref:'y')
        shapes.push({
          type: 'line',
          x0: r.vpos, x1: r.vpos,
          yref: 'y',  y0: y,   y1: y,
          line: { color: bucket.color, width: 1, dash: 'dot' }
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
          showlegend: false
        });
        // markers
        traces.push({
          x: c.markerX,
          y: c.markerY,
          mode: 'markers',
          marker: { size: c.markerSize, color: c.color },
          name: c.name,
          legendgroup: key,
          hoverinfo: 'skip'       // TURN OFF hover here
        });
      });

      // 3) top‐variant crosses in dark red, hover shows variant string
      var variantX = [], variantY = [], variantText = [];
      rows.forEach(function(r){
        var lab = r.trait + ' (' + r.cs + ')';
        variantX.push(r.vpos);
        variantY.push(yIndex[lab]);
        variantText.push(r.variant);  
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
        title:      { text: 'FinnGen SuSiE', font: { size: 16 } },
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
        plot_bgcolor: 'white'
      };

        var endpoints = labels.map(function(l) {
        return l.replace(/\s*\(.*\)$/, '');  
        });
        var uniqueEndpoints = Array.from(new Set(endpoints));
        var summaryEl = document.getElementById('susie-summary');
        var count = uniqueEndpoints.length;
        summaryEl.innerHTML = 
        '<strong>' + count + '</strong> overlapping endpoint' 
        + (count === 1 ? '' : 's') + ': ';

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
        a.style.display      = 'inline-block';
        a.style.padding      = '2px 8px';
        a.style.marginRight  = '6px';
        a.style.borderRadius = '12px';
        a.style.background   = '#f0f0f0';
        a.style.textDecoration = 'underline';
        a.style.color        = '#007bff';

        summaryEl.appendChild(a);
        });

      // Render
      container.innerHTML = '';
      Plotly.newPlot('finngen-susie', traces, layout).then(function(){
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
      });
    })
    .catch(function(err){
      container.innerHTML = 'No SuSiE results in this region.';
      console.error(err);
    });
}

document.addEventListener('DOMContentLoaded', function(){
  renderFinnGenSusie();
  var sel = document.getElementById('endpoint-select');
  if (sel) sel.addEventListener('change', renderFinnGenSusie);
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  if (epToggle) epToggle.addEventListener('change', renderFinnGenSusie);
  if (dgToggle) dgToggle.addEventListener('change', renderFinnGenSusie);
});
