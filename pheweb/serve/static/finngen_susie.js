function csColour(row) {
  return row.good_cs ? '#3500D3' : '#BAA8F0';
}

function isDrug(row) {
  return row.trait.startsWith('ATC_');
}

function classifyRow(row) {
  return 'endpoint_' + (row.good_cs ? 'good' : 'low');
}

function updateToggleStates() {
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');
  var atcToggle = document.getElementById('show-atc-codes');

  if (atcToggle) {
    var dgChecked = dgToggle && dgToggle.checked;
    atcToggle.disabled = !dgChecked;
    if (!dgChecked) atcToggle.checked = false;
    if (atcToggle.parentElement) {
      atcToggle.parentElement.classList.toggle('disabled', !dgChecked);
    }
  }

  if (lqToggle) {
    var disableLq = !(dgToggle && dgToggle.checked) && !(epToggle && epToggle.checked);
    lqToggle.disabled = disableLq;
    if (disableLq) lqToggle.checked = false;
    if (lqToggle.parentElement) {
      lqToggle.parentElement.classList.toggle('disabled', disableLq);
    }
  }
}

// cache of ATC code mapping fetched from the backend
var atcMapPromise = null;
function getAtcMap() {
  if (!atcMapPromise) {
    var url = window.model.urlprefix + '/api/atc';
    atcMapPromise = fetch(url)
      .then(function(resp){ return resp.ok ? resp.json() : {}; })
      .catch(function(){ return {}; });
  }
  return atcMapPromise;
}

function displayEndpoint(ep, atcMap, showCodes) {
  if (showCodes) return ep;
  var m = ep.match(/^ATC_(.+)_IRN$/);
  if (m && atcMap[m[1]]) {
    return atcMap[m[1]];
  }
  return ep;
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
  updateToggleStates();
  var showEP = document.getElementById('show-endpoints');
  showEP = showEP ? showEP.checked : false;
  var showDG = document.getElementById('show-drugs');
  showDG = showDG ? showDG.checked : false;
  var showLQ = document.getElementById('show-low-quality');
  showLQ = showLQ ? showLQ.checked : false;
  var showCodesEl = document.getElementById('show-atc-codes');
  var showCodes = showCodesEl ? showCodesEl.checked : false;
  var summaryEl = document.getElementById('susie-summary');

  if (!showEP && !showDG) {
    container.innerHTML = 'Toggle endpoints or drugs to display results.';
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  container.innerHTML = '<p>Loading...</p>';

  Promise.all([
    fetch(apiUrl).then(function(resp){
      if (!resp.ok) throw new Error("Failed to fetch SuSiE data");
      return resp.json();
    }),
    getAtcMap()
  ])
    .then(function(results) {
      var json = results[0];
      var atcMap = results[1];
      var rows = json.data || json;

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
        if (summaryEl) summaryEl.innerHTML = '';
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
        var name = displayEndpoint(r.trait, atcMap, showCodes);
        var lab = r.cs.length>1 ? name + ' (' + ' ×' + r.cs.length + ')' : name;
        r.label = lab;
        if (labels.indexOf(lab) === -1) labels.push(lab);
      });

      // Helper to wrap long labels onto multiple lines
      function wrapLabel(text, maxLen) {
        var words = text.split(/\s+/);
        var lines = [];
        var current = '';
        words.forEach(function(w){
          var test = current ? current + ' ' + w : w;
          if (test.length > maxLen) {
            if (current) lines.push(current);
            current = w;
          } else {
            current = test;
          }
        });
        if (current) lines.push(current);
        return lines.join('<br>');
      }

      // Determine positions for each label based on wrapped line count
      var maxLineLen = 30;
      var tickvals = [];
      var ticktext = [];
      var yIndex = {};
      var yCursor = 0;  // counts virtual rows
      labels.forEach(function(l){
        var wrapped = wrapLabel(l, maxLineLen);
        var lineCnt = wrapped.split('<br>').length;
        var start = yCursor;
        var end   = yCursor + lineCnt;
        var center = (start + end) / 2;
        tickvals.push(center);
        ticktext.push(wrapped);
        yIndex[l] = center;
        yCursor = end;
      });
      var totalLines = yCursor;

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
        marker: { symbol: 'x', size: 10, color: '#D33500' },
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
          tickvals:  tickvals,
          ticktext:  ticktext,
          showgrid:  false,
          autorange: 'reversed',
          automargin: true
        },
        margin:     { t:34, b:40, l:120, r:20 },
        height:     200 + 25*totalLines,
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

        var endpoints = rows.map(function(r) {
          return r.trait;
        });
        var uniqueEndpoints = Array.from(new Set(endpoints));
        summaryEl = document.getElementById('susie-summary');
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
          + 'that have at least one credible set that intersects'
          + ' the current region"><img src="' +
          window.model.urlprefix + '/static/images/info.svg" class="info-icon info-icon-inline info-icon-inline-lg"'
          + ' alt="Info"></a>: ';


        uniqueEndpoints.forEach(function(ep) {
          var m = ep.match(/^ATC_(.+)_IRN$/);
          var a = document.createElement('a');
          a.textContent = displayEndpoint(ep, atcMap, showCodes);
          a.className = 'btn susie-pill';

          if (m) {
              a.classList.add('btn-drug');
              a.title = 'Drug endpoint';
              // Drug endpoints: keep old behaviour and link to ATC website
              var code = m[1];
              a.href   = 'https://atcddd.fhi.no/atc_ddd_index/?code=' + encodeURIComponent(code);
              a.target = '_blank';
          } else {
              // Non-drug endpoints: populate FinnGen catalog search
          a.href = '#';
          a.addEventListener('click', function(ev){
              ev.preventDefault();
              var searchBox = document.getElementById('endpoint-search');
              if (searchBox) {
                  searchBox.value = ep;
                  searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                  searchBox.dispatchEvent(new Event('change', { bubbles: true }));
                  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
              }
          });
      }

          summaryEl.appendChild(a);
        });

      // Render
      container.innerHTML = '';
      var plotDiv = document.getElementById('finngen-susie');
      plotDiv.style.maxWidth = lzWidth + 'px';
      plotDiv.style.margin = '0 auto';
      layout.width = lzWidth;
      Plotly.newPlot(plotDiv, traces, layout, {responsive: true}).then(function(){
        // add full label tooltips
        var ticks = plotDiv.querySelectorAll('.yaxislayer-above text');
        ticks.forEach(function(t, idx){ t.setAttribute('title', labels[idx]); });

        plotDiv.on('plotly_click', function(evt) {
          try {
            var pts = evt.points || [];
            if (!pts.length) return;
            var v = pts[0].text || '';
            var m = v.match(/^(?:chr)?([0-9XYMT]+)[:\-]([0-9]+)[:\-]([ACGTN]+)[:\-]([ACGTN]+)$/i);
            if (m) {
              var chrom = m[1];
              var pos   = m[2];
              var ref   = m[3].toUpperCase();
              var alt   = m[4].toUpperCase();
              var url = 'https://gnomad.broadinstitute.org/variant/' + encodeURIComponent(chrom + '-' + pos + '-' + ref + '-' + alt);
              window.open(url, '_blank');
              return;
            }
          } catch (e) {
            console.error('Error handling variant click', e);
          }
        });

        // sync with locuszoom state
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
      if (summaryEl) summaryEl.innerHTML = '';
      console.error(err);
    });
}

document.addEventListener('DOMContentLoaded', function(){
  renderFinnGenSusie();

  var searchInput = document.getElementById('endpoint-search');
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');
  var atcToggle = document.getElementById('show-atc-codes');

  var summary = document.getElementById('susie-summary');
  if (summary) {
    summary.addEventListener('wheel', function(e) {
      if (e.deltaY === 0) return;
      e.preventDefault();
      summary.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  if (searchInput) searchInput.addEventListener('change', renderFinnGenSusie);
  if (epToggle) epToggle.addEventListener('change', renderFinnGenSusie);
  if (dgToggle) dgToggle.addEventListener('change', renderFinnGenSusie);
  if (lqToggle) lqToggle.addEventListener('change', renderFinnGenSusie);
  if (atcToggle) atcToggle.addEventListener('change', renderFinnGenSusie);
});

