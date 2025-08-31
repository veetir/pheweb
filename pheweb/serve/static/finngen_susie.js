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
const baseRowHeight = 20;
const railGap = 2;
const endpointColor = '#5D33DB';
const drugColor = '#106527';
const approxPillWidth = 120;   // px, rough width per pill

function measurePillOuterHeight() {
  if (measurePillOuterHeight.cached) return measurePillOuterHeight.cached;
  const test = document.createElement('button');
  test.className = 'pill';
  test.style.visibility = 'hidden';
  test.style.position = 'absolute';
  test.style.left = '-9999px';
  test.textContent = 'TEST_PILL';
  document.body.appendChild(test);
  const h = test.offsetHeight || 24;
  document.body.removeChild(test);
  measurePillOuterHeight.cached = h + 6; // include row gap
  return measurePillOuterHeight.cached;
}

function layoutRows(clusters) {
  const ys = [];
  let y = 0;
  clusters.forEach(c => { ys.push(y); y += baseRowHeight + (c.railHeight || 0); });
  return { yPositions: ys, totalHeight: y };
}

function selectEndpoint(ep) {
  var sel = document.getElementById('endpoint-select');
  if (sel) {
    sel.value = ep;
    sel.dispatchEvent(new Event('change'));
  }

  // Scroll FinnGen plot into view so users can see the results immediately
  var target = document.getElementById('finngen-gwas-catalog');
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({behavior:'smooth'});
  }
}

function renderFinnGenSusie() {
  theme = getTheme();
  var regionEl = document.getElementById('lz-1');
  var region = '';
  if (window.plot && window.plot.state) {
    var st = window.plot.state;
    regionStart = st.start;
    regionEnd = st.end;
    region = st.chr + ':' + regionStart + '-' + regionEnd;
  } else if (regionEl && regionEl.dataset.region) {
    region = regionEl.dataset.region;
    var rng = region.split(':')[1].split('-');
    regionStart = parseInt(rng[0]);
    regionEnd = parseInt(rng[1]);
  } else {
    console.error("No region data found");
    return;
  }
  if (regionEl) regionEl.dataset.region = region;

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
    c.vpos = c.items.map(function(i){ return i.vpos; });
    c.category = c.items[0].category || '';
    c.inter_start = Math.max(c.start, regionStart);
    c.inter_end = Math.min(c.end, regionEnd);
  });
  return clusters;
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

  if (tolInput) {
    var disp = document.getElementById('susie-tol-display');
    if (disp) disp.textContent = tolLabels[tolIdx];
  }

  var clusters = clusterRows(currentRows, tol);
  if (typeof drawUnique.prevTol === 'undefined') drawUnique.prevTol = tol;
  if (drawUnique.prevTol !== tol) {
    drawUnique.prevTol = tol;
  }

  var containerWidth = container.clientWidth ? container.clientWidth : 600;
  var margin = {left:40,right:20,top:20,bottom:20};
  var width = Math.max(50, containerWidth - margin.left - margin.right);
  var barHeight = 6;
  var x = d3.scaleLinear().domain([regionStart, regionEnd]).range([0, width]);

  const pillOuterH = measurePillOuterHeight();
  clusters.forEach(function(c){
    var pillMap = new Map();
    (c.items || []).forEach(function(i){
      if (!pillMap.has(i.trait)) {
        pillMap.set(i.trait, {
          trait: i.trait,
          label: displayEndpoint(i.trait, currentAtcMap, currentShowCodes),
          isDrug: isDrug(i)
        });
      }
    });
    c.pills = Array.from(pillMap.values());
    c.endpoints = c.pills.map(function(p){ return p.label; });
    var n = c.pills.length;
    var perRow = Math.max(1, Math.floor(width / approxPillWidth));
    var rowsNeeded = Math.max(1, Math.ceil(n / perRow));
    c.railHeight = rowsNeeded * pillOuterH + railGap * 2;
  });

  var layout = layoutRows(clusters);

  var wrapper = d3.select('#finngen-susie-wrapper').style('position','relative');

  var railsLayer = wrapper.select('.susie-rails');
  if (railsLayer.empty()) {
    railsLayer = wrapper.append('div').attr('class','susie-rails')
      .style('position','absolute');
  }

  var totalPlotHeight = layout.totalHeight;
  railsLayer
    .style('left',  (margin.left)+'px')
    .style('top',   (margin.top)+'px')
    .style('width', width+'px')
    .style('height', totalPlotHeight+'px')
    .style('z-index', 5)
    .style('pointer-events','none');
  var height = totalPlotHeight + margin.top + margin.bottom;

  var svg = d3.select(container).select('svg');
  if (svg.empty()) svg = d3.select(container).html('').append('svg');
  svg.attr('width', containerWidth)
     .attr('height', height);

  var g = svg.select('g.plot');
  if (g.empty()) g = svg.append('g').attr('class','plot').attr('transform','translate('+margin.left+','+margin.top+')');

  var rows = g.selectAll('g.row').data(clusters, function(d){ return d.id; });

  rows.exit().transition().duration(300).style('opacity',0).remove();

  var rowsEnter = rows.enter().append('g').attr('class','row');

  rowsEnter.append('rect').attr('class','bar').attr('y',(baseRowHeight-barHeight)/2).attr('height',barHeight);
  rowsEnter.append('circle').attr('class','count-circle').attr('cy',baseRowHeight/2);
  rowsEnter.append('text').attr('class','count-text').attr('dy','0.35em').attr('text-anchor','middle').style('font-size','8px');
  rowsEnter.append('path').attr('class','left-cap');
  rowsEnter.append('path').attr('class','right-cap');

  var rowsMerge = rowsEnter.merge(rows);
  rowsMerge.transition().duration(300).attr('transform', function(d,i){ return 'translate(0,'+layout.yPositions[i]+')'; });

  rowsMerge.select('rect.bar').transition().duration(300)
    .attr('x', function(d){ return x(d.inter_start); })
    .attr('width', function(d){ return Math.max(1, x(d.inter_end) - x(d.inter_start)); })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.select('circle.count-circle').transition().duration(300)
    .attr('cx', function(d){ return x(d.inter_start) - 10; })
    .attr('r', function(d){ return 3 + Math.log(d.count + 1) * 2; })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.select('text.count-text').transition().duration(300)
    .attr('x', function(d){ return x(d.inter_start) - 10; })
    .attr('y', baseRowHeight/2)
    .text(function(d){ return d.count; })
    .attr('fill', theme.bg);

  rowsMerge.select('path.left-cap').transition().duration(300)
    .attr('d', function(d){ return d.start < regionStart ? ('M'+(x(d.inter_start)-6)+','+(baseRowHeight/2)+' L'+x(d.inter_start)+','+((baseRowHeight-barHeight)/2)+' L'+x(d.inter_start)+','+((baseRowHeight+barHeight)/2)+' Z') : null; })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.select('path.right-cap').transition().duration(300)
    .attr('d', function(d){ return d.end > regionEnd ? ('M'+x(d.inter_end)+','+((baseRowHeight-barHeight)/2)+' L'+(x(d.inter_end)+6)+','+(baseRowHeight/2)+' L'+x(d.inter_end)+','+((baseRowHeight+barHeight)/2)+' Z') : null; })
    .attr('fill', function(d){ return csColour(d.items[0]); });

  rowsMerge.selectAll('g.variant-ticks').remove();
  rowsMerge.each(function(d){
    var t = d3.select(this).append('g').attr('class','variant-ticks');
    t.selectAll('line').data(d.vpos).enter().append('line')
      .attr('x1', function(v){ return x(v); })
      .attr('x2', function(v){ return x(v); })
      .attr('y1', (baseRowHeight-barHeight)/2)
      .attr('y2', (baseRowHeight+barHeight)/2)
      .attr('stroke', theme.variant)
      .attr('stroke-width',1);
  });
  railsLayer.selectAll('.pill-rail').remove();

  function renderRail(cluster, yTop, width) {
    const rail = railsLayer.append('div')
      .attr('class','pill-rail')
      .style('position','absolute')
      .style('left','0px')
      .style('top',  (yTop + baseRowHeight + railGap) + 'px')
      .style('width', width + 'px')
      .style('height', (cluster.railHeight - railGap*2) + 'px')
      .style('overflow','hidden')
      .style('display','flex')
      .style('flex-wrap','wrap')
      .style('align-content','flex-start')
      .style('gap','6px')
      .style('pointer-events','auto');

    const pills = rail.selectAll('button.pill')
      .data(cluster.pills || [], function(d){ return d.trait; });

    pills.enter().append('button')
      .attr('class','pill')
      .attr('title', function(d){ return d.label; })
      .text(function(d){ return d.label; })
      .each(function(d){
        var el = d3.select(this);
        var bg = d.isDrug ? drugColor : endpointColor;
        el.style('background', bg)
          .style('color', '#fff')
          .style('border', '2px solid ' + bg)
          .style('border-radius','14px')
          .style('padding','2px 10px')
          .style('font-size','12px')
          .style('line-height','18px')
          .style('white-space','nowrap')
          .style('cursor','pointer');
      })
      .on('click', function(d){
        if (window.d3 && d3.event && typeof d3.event.stopPropagation === 'function') {
          d3.event.stopPropagation();
        }
        selectEndpoint(d.trait);
      });
  }

  clusters.forEach(function(c,i){
    renderRail(c, layout.yPositions[i], width);
  });

  if (summaryEl) summaryEl.innerHTML = '';

  svg.select('g.x-axis').remove();
  var axis = d3.axisBottom(x);
  svg.append('g')
    .attr('class','x-axis')
    .attr('transform','translate('+margin.left+','+(height - margin.bottom)+')')
    .call(axis)
    .selectAll('path,line')
    .attr('stroke', theme.grid);
  svg.select('g.x-axis').selectAll('text').attr('fill', theme.fg);
}

document.addEventListener('DOMContentLoaded', function(){
  renderFinnGenSusie();

  var sel      = document.getElementById('endpoint-select');
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');
  var atcToggle = document.getElementById('show-atc-codes');
  var tolInput = document.getElementById('susie-tol');

  if (epToggle) epToggle.addEventListener('change', renderFinnGenSusie);
  if (dgToggle) dgToggle.addEventListener('change', renderFinnGenSusie);
  if (lqToggle) lqToggle.addEventListener('change', renderFinnGenSusie);
  if (atcToggle) atcToggle.addEventListener('change', renderFinnGenSusie);
  if (tolInput) tolInput.addEventListener('input', drawUnique);

  document.addEventListener('pheweb:theme', drawUnique);
  if (window.plot && window.plot.on) {
    window.plot.on('state_changed', function(){
      if (window.plot && window.plot.state) {
        var st = window.plot.state;
        regionStart = st.start;
        regionEnd = st.end;
      }
      drawUnique();
    });
  }
});

