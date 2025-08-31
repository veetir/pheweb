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
    variant: dark ? '#ff7b33' : '#D33500'
  };
}

var theme = {};
var susieData = null;
var expandedCluster = null;

function updateToggleStates() {
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');
  if (lqToggle) {
    var disableLq = !(dgToggle && dgToggle.checked) && !(epToggle && epToggle.checked);
    lqToggle.disabled = disableLq;
    if (disableLq) lqToggle.checked = false;
    if (lqToggle.parentElement) {
      lqToggle.parentElement.classList.toggle('disabled', disableLq);
    }
  }
}

function isDrug(row) {
  return row.trait && row.trait.startsWith('ATC_');
}

function clusterRows(rows, tol) {
  var clusters = [];
  rows.forEach(function(r) {
    var found = clusters.find(function(c) {
      return Math.abs(c.start - r.start) <= tol && Math.abs(c.end - r.end) <= tol;
    });
    if (!found) {
      found = {start: r.start, end: r.end, endpoints: [], variants: [], good: r.good_cs};
      clusters.push(found);
    }
    found.endpoints.push(r.trait);
    found.variants.push({pos: r.vpos, variant: r.variant});
    if (r.good_cs) found.good = true;
  });
  return clusters;
}

function showSummary(cluster) {
  var summary = document.getElementById('susie-summary');
  if (!summary) return;
  summary.innerHTML = '';
  if (!cluster) return;
  cluster.endpoints.forEach(function(ep) {
    var span = document.createElement('span');
    span.className = 'btn susie-pill';
    span.textContent = ep;
    summary.appendChild(span);
  });
}

function drawClusters(clusters, region) {
  var container = d3.select('#finngen-susie');
  container.html('');
  var width = document.getElementById('lz-1').clientWidth;
  var margin = {left: 40, right: 20, top: 10, bottom: 10};
  var rowStep = 22;
  var barHeight = 6;
  var height = margin.top + margin.bottom + clusters.length * rowStep;

  var svg = container.append('svg')
    .attr('width', width)
    .attr('height', height);

  var x = d3.scaleLinear()
    .domain([region.start, region.end])
    .range([margin.left, width - margin.right]);

  var tooltip = d3.select('.susie-tooltip');
  if (tooltip.empty()) {
    tooltip = d3.select('body').append('div')
      .attr('class', 'susie-tooltip')
      .style('opacity', 0);
  }

  var rows = svg.selectAll('.susie-row')
    .data(clusters, function(d){ return d.start + '-' + d.end; });

  var rowsEnter = rows.enter().append('g')
    .attr('class', 'susie-row')
    .attr('transform', function(d,i){ return 'translate(0,' + (margin.top + i*rowStep) + ')'; })
    .style('opacity', 0);

  rowsEnter.transition().duration(500).style('opacity',1);

  rows.exit().transition().duration(500).style('opacity',0).remove();

  rows = rows.merge(rowsEnter)
    .transition().duration(500)
    .attr('transform', function(d,i){ return 'translate(0,' + (margin.top + i*rowStep) + ')'; })
    .selection();

  rows.each(function(d){
    var g = d3.select(this);
    g.selectAll('*').remove();
    var barStart = Math.max(d.start, region.start);
    var barEnd = Math.min(d.end, region.end);
    var color = d.good ? theme.good : theme.low;

    var count = d.endpoints.length;
    var cx = x(region.start) - 15;
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', 0)
      .attr('r', 3 + Math.log(count))
      .attr('fill', theme.fg);

    g.append('rect')
      .attr('x', x(barStart))
      .attr('y', -barHeight/2)
      .attr('width', x(barEnd) - x(barStart))
      .attr('height', barHeight)
      .attr('fill', color)
      .attr('class', 'susie-bar');

    if (d.start < region.start) {
      g.append('path')
        .attr('d', 'M' + x(region.start) + ' ' + (-barHeight/2) + ' L' + (x(region.start)-6) + ' 0 L' + x(region.start) + ' ' + (barHeight/2) + ' Z')
        .attr('fill', color);
    }
    if (d.end > region.end) {
      g.append('path')
        .attr('d', 'M' + x(region.end) + ' ' + (-barHeight/2) + ' L' + (x(region.end)+6) + ' 0 L' + x(region.end) + ' ' + (barHeight/2) + ' Z')
        .attr('fill', color);
    }

    g.append('text')
      .attr('x', x(barEnd) + 4)
      .attr('y', 4)
      .attr('class', 'count-badge')
      .text('×' + count);

    var variants = (expandedCluster === d) ? d.variants : [];
    g.selectAll('.variant')
      .data(variants)
      .enter()
      .append('line')
      .attr('class', 'variant')
      .attr('x1', function(v){ return x(v.pos); })
      .attr('x2', function(v){ return x(v.pos); })
      .attr('y1', -barHeight/2 - 4)
      .attr('y2', barHeight/2 + 4)
      .attr('stroke', theme.variant)
      .attr('stroke-width', 1);

    g.on('mousemove', function(evt){
      tooltip.style('opacity',1)
        .html('[' + d.start + ', ' + d.end + '] width ' + (d.end - d.start) + '<br>#endpoints: ' + count + '<br>' + d.endpoints.slice(0,3).join(', '))
        .style('left', (evt.pageX + 5) + 'px')
        .style('top', (evt.pageY + 5) + 'px');
    }).on('mouseout', function(){
      tooltip.style('opacity',0);
    }).on('click', function(){
      expandedCluster = (expandedCluster === d) ? null : d;
      drawClusters(clusters, region);
      showSummary(expandedCluster);
    });
  });
}

function renderFinnGenSusie() {
  theme = getTheme();
  var regionEl = document.getElementById('lz-1');
  if (!regionEl || !regionEl.dataset.region) return;
  var regionStr = regionEl.dataset.region;
  var parts = regionStr.split(':');
  var chr = parts[0];
  var range = parts[1].split('-');
  var region = { chr: chr, start: +range[0], end: +range[1] };

  var apiUrl = window.model.urlprefix + '/api/finngen-susie?region=chr' + regionStr;
  var container = document.getElementById('finngen-susie');
  var summaryEl = document.getElementById('susie-summary');

  updateToggleStates();
  var showEP = document.getElementById('show-endpoints');
  showEP = showEP ? showEP.checked : false;
  var showDG = document.getElementById('show-drugs');
  showDG = showDG ? showDG.checked : false;
  var showLQ = document.getElementById('show-low-quality');
  showLQ = showLQ ? showLQ.checked : false;

  if (!showEP && !showDG) {
    container.innerHTML = 'Toggle endpoints or drugs to display results.';
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  var sortBy = document.getElementById('susie-sort').value;
  var tol = parseFloat(document.getElementById('susie-tolerance').value || 0) * 1000;

  container.innerHTML = '<p>Loading...</p>';

  fetch(apiUrl).then(function(resp){
    if (!resp.ok) throw new Error('Failed to fetch SuSiE data');
    return resp.json();
  }).then(function(json){
    var rows = (json.data || json).filter(function(r){
      return (isDrug(r) ? showDG : showEP) && (showLQ || r.good_cs);
    });
    if (!rows.length) {
      container.innerHTML = 'No SuSiE results in this region.';
      if (summaryEl) summaryEl.innerHTML = '';
      return;
    }
    expandedCluster = null;
    showSummary(null);
    var clusters = clusterRows(rows, tol);
    clusters.forEach(function(c){ c.width = c.end - c.start; });
    clusters.sort(function(a,b){
      if (sortBy === 'width') return a.width - b.width;
      if (sortBy === 'count') return b.endpoints.length - a.endpoints.length;
      return a.start - b.start;
    });
    drawClusters(clusters, region);
  }).catch(function(){
    container.innerHTML = 'No SuSiE results in this region.';
    if (summaryEl) summaryEl.innerHTML = '';
  });
}

document.addEventListener('DOMContentLoaded', function(){
  renderFinnGenSusie();
  ['endpoint-select','show-endpoints','show-drugs','show-low-quality','show-atc-codes','susie-sort','susie-tolerance']
    .forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', renderFinnGenSusie);
    });
});

document.addEventListener('pheweb:theme', renderFinnGenSusie);

