function getTheme() {
  var styles = getComputedStyle(document.body);
  var bg = styles.getPropertyValue('--bs-body-bg').trim() || 'white';
  var fg = styles.getPropertyValue('--bs-body-color').trim() || 'black';
  var dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  return {
    bg: bg,
    fg: fg,
    dark: dark,
    good: dark ? '#a47cff' : '#3500D3',
    low: dark ? '#d8cff8' : '#BAA8F0',
    variant: dark ? '#ff7b33' : '#D33500',
    grid: dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
  };
}

var theme = {};

function csColour(row) {
  return row.good_cs ? theme.good : theme.low;
}

function isDrug(row) {
  return row.trait && row.trait.startsWith('ATC_');
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

var currentRows = [];
var currentAtcMap = {};
var currentShowCodes = false;
var regionStart = 0, regionEnd = 0;
var expandedClusters = new Set();

function selectEndpoint(ep) {
  var sel = document.getElementById('endpoint-select');
  if (sel) {
    sel.value = ep;
    sel.dispatchEvent(new Event('change'));
  }
}

function renderFinnGenSusie() {
  theme = getTheme();
  var regionEl = document.getElementById('lz-1');
  if (!regionEl || !regionEl.dataset.region) {
    console.error("No region data found on element with id 'lz-1'");
    return;
  }
  var region = regionEl.dataset.region;
  var rng = region.split(':')[1].split('-');
  regionStart = parseInt(rng[0]);
  regionEnd = parseInt(rng[1]);

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
  currentShowCodes = showCodesEl ? showCodesEl.checked : false;
  var summaryEl = document.getElementById('susie-summary');

  if (!showEP && !showDG) {
    container.innerHTML = 'Toggle endpoints or drugs to display results.';
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  container.innerHTML = '<p>Loading...</p>';

  Promise.all([
    fetch(apiUrl).then(function(resp){
      if (!resp.ok) throw new Error('Failed to fetch SuSiE data');
      return resp.json();
    }),
    getAtcMap()
  ])
    .then(function(results) {
      var json = results[0];
      currentAtcMap = results[1];
      var rows = json.data || json;

      rows = rows.filter(function(r) { return isDrug(r) ? showDG : showEP; });
      if (!showLQ) {
        rows = rows.filter(function(r){ return r.good_cs; });
      }

      if (!rows.length) {
        container.innerHTML = 'No SuSiE results in this region.';
        if (summaryEl) summaryEl.innerHTML = '';
        return;
      }

      currentRows = rows;
      expandedClusters = new Set();
      drawUnique();
    })
    .catch(function(err){
      container.innerHTML = 'No SuSiE results in this region.';
      if (summaryEl) summaryEl.innerHTML = '';
      console.error(err);
    });
}

function clusterRows(rows, tol) {
  var clusters = [];
  rows.sort(function(a,b){ return a.start - b.start; });
  rows.forEach(function(r){
    var found = null;
    for (var i=0;i<clusters.length;i++) {
      var c = clusters[i];
      if (Math.abs(r.start - c.start) + Math.abs(r.end - c.end) <= tol) {
        found = c; break;
      }
    }
    if (found) {
      found.items.push(r);
      found.start = Math.min(found.start, r.start);
      found.end = Math.max(found.end, r.end);
      found.good_cs = found.good_cs && r.good_cs;
    } else {
      clusters.push({start:r.start, end:r.end, good_cs:r.good_cs, items:[r]});
    }
  });

  clusters.forEach(function(c){
    c.id = c.start + '-' + c.end;
    c.count = c.items.length;
    c.endpoints = c.items.map(function(i){ return displayEndpoint(i.trait, currentAtcMap, currentShowCodes); });
    c.vpos = c.items.map(function(i){ return i.vpos; });
    c.category = c.items[0].category || '';
    c.inter_start = Math.max(c.start, regionStart);
    c.inter_end = Math.min(c.end, regionEnd);
  });
  return clusters;
}

function sortClusters(clusters, mode) {
  switch(mode) {
    case 'width':
      clusters.sort(function(a,b){ return (a.inter_end - a.inter_start) - (b.inter_end - b.inter_start); });
      break;
    case 'count':
      clusters.sort(function(a,b){ return b.count - a.count; });
      break;
    case 'category':
      clusters.sort(function(a,b){ return (a.category||'').localeCompare(b.category||''); });
      break;
    default:
      clusters.sort(function(a,b){ return a.inter_start - b.inter_start; });
  }
}

function drawUnique() {
  var container = document.getElementById('finngen-susie');
  var summaryEl = document.getElementById('susie-summary');
  if (!container) return;

  theme = getTheme();

  var tolInput = document.getElementById('susie-tol');
  var tolScale = [0, 10000, 100000, 1000000, 1e9];
  var tolLabels = ['0','10k','100k','1M','All'];
  var tolIdx = tolInput ? parseInt(tolInput.value) || 0 : 0;
  var tol = tolScale[tolIdx];
  var sortSel = document.getElementById('susie-sort');
  var sortMode = sortSel ? sortSel.value : 'start';

  if (tolInput) {
    var disp = document.getElementById('susie-tol-display');
    if (disp) disp.textContent = tolLabels[tolIdx];
  }

  var clusters = clusterRows(currentRows, tol);
  sortClusters(clusters, sortMode);

  if (expandedClusters.size === 0) {
    clusters.forEach(function(c){ expandedClusters.add(c.id); });
  } else {
    clusters.forEach(function(c){ if(!expandedClusters.has(c.id)) expandedClusters.add(c.id); });
  }

  var width = container.clientWidth ? container.clientWidth - 40 : 600;
  var margin = {left:40,right:20,top:20,bottom:20};
  var rowHeight = 20;
  var barHeight = 6;
  var height = clusters.length * rowHeight + margin.top + margin.bottom;

  var x = d3.scaleLinear().domain([regionStart, regionEnd]).range([0, width]);

  d3.select('#finngen-susie-wrapper').style('position', 'relative');
  var tooltip = d3.select('#finngen-susie-wrapper').select('.susie-tooltip');
  if (tooltip.empty()) {
    tooltip = d3.select('#finngen-susie-wrapper').append('div').attr('class', 'susie-tooltip')
      .style('position','absolute').style('pointer-events','none')
      .style('padding','2px 4px').style('border-radius','4px')
      .style('border','1px solid '+theme.fg).style('background', theme.bg).style('color', theme.fg)
      .style('opacity',0);
  } else {
    tooltip.style('border','1px solid '+theme.fg).style('background', theme.bg).style('color', theme.fg);
  }

  var svg = d3.select(container).select('svg');
  if (svg.empty()) svg = d3.select(container).html('').append('svg');
  svg.attr('width', width + margin.left + margin.right)
     .attr('height', height);

  var g = svg.select('g.plot');
  if (g.empty()) g = svg.append('g').attr('class','plot').attr('transform','translate('+margin.left+','+margin.top+')');

  var rows = g.selectAll('g.row').data(clusters, function(d){ return d.id; });

  rows.exit().transition().duration(300).style('opacity',0).remove();

  var rowsEnter = rows.enter().append('g').attr('class','row').style('cursor','pointer')
    .on('mouseover', function(event,d){ showTooltip(d,event,tooltip); })
    .on('mousemove', function(event){ moveTooltip(event,tooltip); })
    .on('mouseout', function(){ hideTooltip(tooltip); })
    .on('click', function(event,d){
      if (expandedClusters.has(d.id)) expandedClusters.delete(d.id);
      else expandedClusters.add(d.id);
      drawUnique();
    });

  rowsEnter.append('rect').attr('class','bar').attr('y',(rowHeight-barHeight)/2).attr('height',barHeight);
  rowsEnter.append('circle').attr('class','count-circle').attr('cy',rowHeight/2);
  rowsEnter.append('text').attr('class','count-text').attr('dy','0.35em').attr('text-anchor','middle').style('font-size','8px');
  rowsEnter.append('path').attr('class','left-cap');
  rowsEnter.append('path').attr('class','right-cap');

  var rowsMerge = rowsEnter.merge(rows);
  rowsMerge.transition().duration(500).attr('transform', function(d,i){ return 'translate(0,'+(i*rowHeight)+')'; });

  rowsMerge.select('rect.bar').transition().duration(500)
    .attr('x', function(d){ return x(d.inter_start); })
    .attr('width', function(d){ return Math.max(1, x(d.inter_end) - x(d.inter_start)); })
    .attr('fill', function(d){ return csColour(d.items[0]); })
    .attr('stroke', function(d){ return expandedClusters.has(d.id) ? theme.variant : 'none'; })
    .attr('stroke-width', function(d){ return expandedClusters.has(d.id) ? 2 : 0; });

  rowsMerge.select('circle.count-circle').transition().duration(500)
    .attr('cx', function(d){ return x(d.inter_start) - 10; })
    .attr('r', function(d){ return 3 + Math.log(d.count + 1) * 2; })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.select('text.count-text').transition().duration(500)
    .attr('x', function(d){ return x(d.inter_start) - 10; })
    .attr('y', rowHeight/2)
    .text(function(d){ return d.count; })
    .attr('fill', theme.bg);

  rowsMerge.select('path.left-cap').transition().duration(500)
    .attr('d', function(d){ return d.start < regionStart ? ('M'+(x(d.inter_start)-6)+','+(rowHeight/2)+' L'+x(d.inter_start)+','+((rowHeight-barHeight)/2)+' L'+x(d.inter_start)+','+((rowHeight+barHeight)/2)+' Z') : null; })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.select('path.right-cap').transition().duration(500)
    .attr('d', function(d){ return d.end > regionEnd ? ('M'+x(d.inter_end)+','+((rowHeight-barHeight)/2)+' L'+(x(d.inter_end)+6)+','+(rowHeight/2)+' L'+x(d.inter_end)+','+((rowHeight+barHeight)/2)+' Z') : null; })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.selectAll('g.variant-ticks').remove();
  rowsMerge.selectAll('g.endpoints').remove();
  rowsMerge.filter(function(d){ return expandedClusters.has(d.id); }).each(function(d){
    var t = d3.select(this).append('g').attr('class','variant-ticks');
    t.selectAll('line').data(d.vpos).enter().append('line')
      .attr('x1', function(v){ return x(v); })
      .attr('x2', function(v){ return x(v); })
      .attr('y1', (rowHeight-barHeight)/2)
      .attr('y2', (rowHeight+barHeight)/2)
      .attr('stroke', theme.variant)
      .attr('stroke-width',1);

    var e = d3.select(this).append('g').attr('class','endpoints');
    var xoff = x(d.inter_end) + 5;
    d.endpoints.forEach(function(ep){
      var txt = e.append('text').text(ep)
        .attr('x', xoff).attr('y', rowHeight/2 + 3)
        .attr('fill', theme.fg).style('font-size','10px')
        .style('cursor','pointer')
        .on('click', function(){ selectEndpoint(ep); });
      xoff += txt.node().getComputedTextLength() + 8;
    });
  });

  if (summaryEl) summaryEl.innerHTML = '';
}

function showTooltip(d, event, tooltip) {
  var ex = (d.endpoints || []).slice(0,3).join(', ');
  var html = '['+d.start+'-'+d.end+']<br>width '+(d.end-d.start)+' bp<br>#endpoints '+d.count;
  if (ex) html += '<br>'+ex;
  tooltip.html(html).style('opacity',1);
  moveTooltip(event, tooltip);
}

function moveTooltip(event, tooltip) {
  var container = document.getElementById('finngen-susie-wrapper');
  var rect = container.getBoundingClientRect();
  tooltip.style('left', (event.clientX - rect.left + 15) + 'px')
         .style('top', (event.clientY - rect.top + 15) + 'px');
}

function hideTooltip(tooltip) {
  tooltip.style('opacity',0);
}

document.addEventListener('DOMContentLoaded', function(){
  renderFinnGenSusie();

  var sel      = document.getElementById('endpoint-select');
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');
  var atcToggle = document.getElementById('show-atc-codes');
  var sortSel  = document.getElementById('susie-sort');
  var tolInput = document.getElementById('susie-tol');

  if (sel)      sel.addEventListener('change', renderFinnGenSusie);
  if (epToggle) epToggle.addEventListener('change', renderFinnGenSusie);
  if (dgToggle) dgToggle.addEventListener('change', renderFinnGenSusie);
  if (lqToggle) lqToggle.addEventListener('change', renderFinnGenSusie);
  if (atcToggle) atcToggle.addEventListener('change', renderFinnGenSusie);
  if (sortSel)  sortSel.addEventListener('change', drawUnique);
  if (tolInput) tolInput.addEventListener('input', drawUnique);

  document.addEventListener('pheweb:theme', drawUnique);
});

