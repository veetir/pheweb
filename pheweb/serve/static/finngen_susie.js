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
  var tolInput = document.getElementById('susie-tol');
  var tolLabel = document.querySelector('label[for="susie-tol"]');
  var epCodesToggle = document.getElementById('show-endpoint-codes');

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

  // Disable Grouping slider when both Endpoints and Drugs are off
  var disableGrouping = !(dgToggle && dgToggle.checked) && !(epToggle && epToggle.checked);
  if (tolInput) {
    tolInput.disabled = disableGrouping;
  }
  if (tolLabel) {
    tolLabel.classList.toggle('disabled', disableGrouping);
  }

  // Enable Endpoint codes only when Endpoints are shown
  if (epCodesToggle) {
    var disableEpCodes = !(epToggle && epToggle.checked);
    epCodesToggle.disabled = disableEpCodes;
    if (disableEpCodes) epCodesToggle.checked = false;
    if (epCodesToggle.parentElement) {
      epCodesToggle.parentElement.classList.toggle('disabled', disableEpCodes);
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

// Endpoint code -> human-readable name
var endpointMapPromise = null;
function getEndpointMap() {
  if (endpointMapPromise) return endpointMapPromise;
  function arrayToMap(arr) {
    var map = {};
    (arr || []).forEach(function(item){
      if (item && item.endpoint) map[item.endpoint] = item.phenotype || item.endpoint;
    });
    return map;
  }
  if (Array.isArray(window.allEndpoints) && window.allEndpoints.length) {
    endpointMapPromise = Promise.resolve(arrayToMap(window.allEndpoints));
  } else if (window.endpointsTsvUrl) {
    endpointMapPromise = fetch(window.endpointsTsvUrl)
      .then(function(resp){ return resp.ok ? resp.text() : ''; })
      .then(function(text){
        var lines = (text || '').trim().split('\n');
        if (!lines.length) return {};
        var headers = lines[0].split('\t');
        var endpointIdx = headers.indexOf('endpoint');
        var phenotypeIdx = headers.indexOf('phenotype');
        var arr = [];
        for (var i=1;i<lines.length;i++){
          var cols = lines[i].split('\t');
          if (cols.length > Math.max(endpointIdx, phenotypeIdx)) {
            var endpoint = (cols[endpointIdx] || '').trim();
            var phenotype = (cols[phenotypeIdx] || '').trim();
            if (endpoint) arr.push({endpoint:endpoint, phenotype:phenotype});
          }
        }
        return arrayToMap(arr);
      })
      .catch(function(){ return {}; });
  } else {
    endpointMapPromise = Promise.resolve({});
  }
  return endpointMapPromise;
}

function endpointDisplayName(code) {
  return (currentEndpointMap && currentEndpointMap[code]) ? currentEndpointMap[code] : code;
}

function truncateLabel(txt, maxLen) {
  maxLen = maxLen || 36;
  if (!txt) return '';
  if (txt.length <= maxLen) return txt;
  return txt.slice(0, maxLen - 1) + '…';
}

var currentRows = [];
var currentAtcMap = {};
var currentShowCodes = false;
var currentEndpointMap = {};
var currentShowEndpointCodes = false;
var regionStart = 0, regionEnd = 0;
const baseRowHeight = 20;
const railGap = 2;
const endpointColor = '#5D33DB';
const drugColor = '#106527';
const approxPillWidth = 120;   // px, rough width per pill (legacy, no longer used for height)
const pillToggleSpace = 18;    // px reserved at right for expand/collapse toggle

// Track which clusters are expanded (by id)
var expandedClusters = new Set();

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
  measurePillOuterHeight.cached = h + 12; // include row gap
  return measurePillOuterHeight.cached;
}

function layoutRows(clusters) {
  const ys = [];
  let y = 0;
  clusters.forEach(c => { ys.push(y); y += baseRowHeight + (c.railHeight || 0); });
  return { yPositions: ys, totalHeight: y };
}

function selectEndpoint(ep) {
  function glow(selectEl) {
    if (!selectEl) return;
    selectEl.classList.add('highlight-dropdown');
    clearTimeout(selectEl._highlightTimeout);
    selectEl._highlightTimeout = setTimeout(function(){
      selectEl.classList.remove('highlight-dropdown');
    }, 2000);
  }

  if (typeof window.setFinnGenEndpoint === 'function') {
    window.setFinnGenEndpoint(ep);
    glow(document.getElementById('endpoint-select'));
  } else {
    var search = document.getElementById('endpoint-search');
    if (search) {
      search.value = ep;
      search.dispatchEvent(new Event('input'));
    }

    var sel = document.getElementById('endpoint-select');
    if (sel) {
      // wait for search filter to repopulate options
      setTimeout(function(){
        sel.value = ep;
        sel.dispatchEvent(new Event('change'));
        glow(sel);
      }, 350);
    }
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
  var showEndpointCodesEl = document.getElementById('show-endpoint-codes');
  currentShowEndpointCodes = showEndpointCodesEl ? !!showEndpointCodesEl.checked : false;
  var topInRegionEl = document.getElementById('susie-filter-top-in-region');
  var filterTopInRegion = topInRegionEl ? !!topInRegionEl.checked : true;
  var summaryEl = document.getElementById('susie-summary');

  if (!showEP && !showDG) {
    container.innerHTML = 'Toggle endpoints or drugs to display results.';
    // Clear any existing rails from previous renders
    var wrapper = d3.select('#finngen-susie-wrapper');
    var rails = wrapper.select('.susie-rails');
    if (!rails.empty()) rails.remove();
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  container.innerHTML = '<p>Loading...</p>';

  Promise.all([
    fetch(apiUrl).then(function(resp){
      if (!resp.ok) throw new Error('Failed to fetch SuSiE data');
      return resp.json();
    }),
    getAtcMap(),
    getEndpointMap()
  ])
    .then(function(results) {
      var json = results[0];
      currentAtcMap = results[1];
      currentEndpointMap = results[2] || {};
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

      // Optionally filter to show only CS with top variant in region
      if (filterTopInRegion) {
        rows = rows.filter(function(r){
          return (typeof r.vpos === 'number') && r.vpos >= regionStart && r.vpos <= regionEnd;
        });
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

  // If both toggles are off, show message and clear rails, then exit
  var epToggle = document.getElementById('show-endpoints');
  var dgToggle = document.getElementById('show-drugs');
  var epOn = epToggle ? !!epToggle.checked : false;
  var dgOn = dgToggle ? !!dgToggle.checked : false;
  if (!epOn && !dgOn) {
    container.innerHTML = 'Toggle endpoints or drugs to display results.';
    var wrapper = d3.select('#finngen-susie-wrapper');
    var rails = wrapper.select('.susie-rails');
    if (!rails.empty()) rails.remove();
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

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

  // Build pill/variant data and measure actual rail heights to avoid clipping
  clusters.forEach(function(c){
    var pillMap = new Map();
    var variantMap = new Map();
    (c.items || []).forEach(function(i){
      var isDrugItem = isDrug(i);
      if (!pillMap.has(i.trait)) {
        var labelRaw;
        if (isDrugItem) {
          // Drug labels: toggle between ATC code vs name
          labelRaw = displayEndpoint(i.trait, currentAtcMap, currentShowCodes);
        } else {
          // Endpoint labels: toggle between endpoint code vs human-readable name
          labelRaw = currentShowEndpointCodes ? i.trait : endpointDisplayName(i.trait);
        }
        pillMap.set(i.trait, {
          trait: i.trait,
          isDrug: isDrugItem,
          fullName: isDrugItem ? displayEndpoint(i.trait, currentAtcMap, false) : endpointDisplayName(i.trait),
          label: truncateLabel(labelRaw, 36)
        });
      }
      if (!variantMap.has(i.variant)) {
        variantMap.set(i.variant, {
          variant: i.variant,
          vpos: i.vpos,
          traits: [
            isDrugItem
              ? displayEndpoint(i.trait, currentAtcMap, currentShowCodes)
              : (currentShowEndpointCodes ? i.trait : endpointDisplayName(i.trait))
          ]
        });
      } else {
        variantMap.get(i.variant).traits.push(
          isDrugItem
            ? displayEndpoint(i.trait, currentAtcMap, currentShowCodes)
            : (currentShowEndpointCodes ? i.trait : endpointDisplayName(i.trait))
        );
      }
    });
    c.pills = Array.from(pillMap.values());
    c.endpoints = c.pills.map(function(p){ return p.label; });
    c.variants = Array.from(variantMap.values());

    // Create an offscreen measurement container to compute exact layout
    var meas = d3.select('body').append('div')
      .style('position','absolute')
      .style('left','-99999px')
      .style('top','0px')
      .style('width', width + 'px')
      .style('display','flex')
      .style('flex-wrap','wrap')
      .style('align-content','flex-start')
      .style('gap','6px')
      .style('padding-right', pillToggleSpace + 'px')
      .style('visibility','hidden')
      .style('pointer-events','none');

    meas.selectAll('button.pill')
      .data(c.pills)
      .enter()
      .append('button')
      .attr('class','pill')
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
          .style('cursor', 'pointer');
      });

    var node = meas.node();
    var contentHeight = Math.ceil(node.scrollHeight || node.getBoundingClientRect().height || 0);
    var rowHeight = 0;
    var rowTops = new Set();
    meas.selectAll('button.pill').each(function(){
      rowHeight = Math.max(rowHeight, this.offsetHeight || 0);
      rowTops.add(this.offsetTop || 0);
    });
    var rowsCount = Math.max(1, rowTops.size || 1);
    meas.remove();

    c.rowsCount = rowsCount;
    c.fullRailContentHeight = contentHeight; // without top/bottom railGap
    c.rowContentHeight = Math.ceil(rowHeight);

    // Choose collapsed vs expanded height. Default collapsed to 1 row when multiple rows exist.
    var isExpanded = expandedClusters.has(c.id);
    var desiredContent = (isExpanded || rowsCount <= 1) ? c.fullRailContentHeight : c.rowContentHeight;
    c.railHeight = desiredContent + railGap * 2; // include top/bottom rail margin
  });

  var layout = layoutRows(clusters);

  var wrapper = d3.select('#finngen-susie-wrapper').style('position','relative');

  var railsLayer = wrapper.select('.susie-rails');
  if (railsLayer.empty()) {
    railsLayer = wrapper.append('div').attr('class','susie-rails')
      .style('position','absolute');
  }

  var tooltip = wrapper.select('.susie-tooltip');
  if (tooltip.empty()) {
    tooltip = wrapper.append('div').attr('class','susie-tooltip')
      .style('position','absolute')
      .style('pointer-events','none')
      .style('opacity',0)
      .style('padding','4px 8px')
      .style('font-size','11px')
      .style('border-radius','4px')
      .style('z-index',10);
  }
  tooltip.style('background', theme.bg)
    .style('color', theme.fg)
    .style('border', '1px solid '+theme.grid);

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
  // Track width to enable cheap resize checks
  drawUnique._prevWidth = containerWidth;

  var g = svg.select('g.plot');
  if (g.empty()) g = svg.append('g').attr('class','plot').attr('transform','translate('+margin.left+','+margin.top+')');

  var rows = g.selectAll('g.row').data(clusters, function(d){ return d.id; });

  rows.exit().transition().duration(300).style('opacity',0).remove();

  var rowsEnter = rows.enter().append('g').attr('class','row');

  rowsEnter.append('rect').attr('class','bar').attr('y',(baseRowHeight-barHeight)/2).attr('height',barHeight);
  rowsEnter.append('path').attr('class','left-cap');
  rowsEnter.append('path').attr('class','right-cap');

  var rowsMerge = rowsEnter.merge(rows);
  rowsMerge.transition().duration(300).attr('transform', function(d,i){ return 'translate(0,'+layout.yPositions[i]+')'; });

  // Clean up any legacy count markers from previous versions
  rowsMerge.selectAll('.count-circle, .count-text').remove();

  rowsMerge.select('rect.bar').transition().duration(300)
    .attr('x', function(d){ return x(d.inter_start); })
    .attr('width', function(d){ return Math.max(1, x(d.inter_end) - x(d.inter_start)); })
    .attr('fill', function(d){ return csColour(d.items[0]); })
    .attr('fill-opacity', 0.2);

  // Removed count bubble and text for clarity

  rowsMerge.select('path.left-cap').transition().duration(300)
    .attr('d', function(d){ return d.start < regionStart ? ('M'+(x(d.inter_start)-6)+','+(baseRowHeight/2)+' L'+x(d.inter_start)+','+((baseRowHeight-barHeight)/2)+' L'+x(d.inter_start)+','+((baseRowHeight+barHeight)/2)+' Z') : null; })
    .attr('fill', function(d){ return csColour(d.items[0]); })
    .attr('fill-opacity', 0.2);

  rowsMerge.select('path.right-cap').transition().duration(300)
    .attr('d', function(d){ return d.end > regionEnd ? ('M'+x(d.inter_end)+','+((baseRowHeight-barHeight)/2)+' L'+(x(d.inter_end)+6)+','+(baseRowHeight/2)+' L'+x(d.inter_end)+','+((baseRowHeight+barHeight)/2)+' Z') : null; })
    .attr('fill', function(d){ return csColour(d.items[0]); })
    .attr('fill-opacity', 0.2);

  function showVarTip(v, event) {
    var html = v.variant;
    if (v.traits && v.traits.length) {
      html += '<br>' + v.traits.join(', ');
    }
    tooltip.html(html).style('opacity',1);
    moveVarTip(event);
  }
  function moveVarTip(event) {
    var node = wrapper.node();
    var rect = node.getBoundingClientRect();
    var xPos = event.clientX - rect.left + (node.scrollLeft || 0) + 12;
    var yPos = event.clientY - rect.top + (node.scrollTop || 0) + 12;

    // Keep tooltip within visible wrapper bounds
    var tw = (tooltip.node() && tooltip.node().offsetWidth) || 0;
    var th = (tooltip.node() && tooltip.node().offsetHeight) || 0;
    var minX = (node.scrollLeft || 0) + 4;
    var minY = (node.scrollTop || 0) + 4;
    var maxX = (node.scrollLeft || 0) + node.clientWidth - tw - 4;
    var maxY = (node.scrollTop || 0) + node.clientHeight - th - 4;
    xPos = Math.max(minX, Math.min(xPos, maxX));
    yPos = Math.max(minY, Math.min(yPos, maxY));

    tooltip.style('left', xPos + 'px').style('top', yPos + 'px');
  }
  function hideVarTip() { tooltip.style('opacity',0); }

  rowsMerge.selectAll('g.variant-ticks').remove();
  rowsMerge.each(function(d){
    var t = d3.select(this).append('g').attr('class','variant-ticks');
    var mk = t.selectAll('g.tick').data(d.variants || []).enter().append('g')
      .attr('class','tick')
      .attr('transform', function(v){ return 'translate('+x(v.vpos)+','+ (baseRowHeight/2) +')'; })
      .style('cursor','pointer')
      .on('mouseover', function(v){
        showVarTip(v, d3.event);
        d3.select(this)
          .transition().duration(80)
          .attr('transform', 'translate('+x(v.vpos)+','+ (baseRowHeight/2) +') scale(1.2)');
      })
      .on('mousemove', function(){ moveVarTip(d3.event); })
      .on('mouseout', function(v){
        hideVarTip();
        d3.select(this)
          .transition().duration(100)
          .attr('transform', 'translate('+x(v.vpos)+','+ (baseRowHeight/2) +') scale(1)');
      })
      .on('click', function(v){
        if (v && v.variant) {
          var parts = v.variant.split(':');
          if (parts.length >= 4) {
            var url = 'https://gnomad.broadinstitute.org/variant/' +
                      parts[0] + '-' + parts[1] + '-' + parts[2] + '-' + parts[3];
            window.open(url, '_blank');
          }
        }
      });
    mk.append('line')
      .attr('x1', -5).attr('y1', -5).attr('x2', 5).attr('y2', 5)
      .attr('stroke', theme.variant).attr('stroke-width',3);
    mk.append('line')
      .attr('x1', -5).attr('y1', 5).attr('x2', 5).attr('y2', -5)
      .attr('stroke', theme.variant).attr('stroke-width',3);
  });
  railsLayer.selectAll('.pill-rail').remove();

  function renderRail(cluster, yTop, width) {
    const rail = railsLayer.append('div')
      .attr('class','pill-rail')
      .style('position','absolute')
      .style('left','0px')
      .style('top',  (yTop + baseRowHeight + railGap) + 'px')
      .style('width', width + 'px')
      .style('height', Math.ceil(cluster.railHeight - railGap*2) + 'px')
      .style('overflow','hidden')
      .style('display','flex')
      .style('flex-wrap','wrap')
      .style('align-content','flex-start')
      .style('gap','6px')
      .style('padding-right', pillToggleSpace + 'px')
      .style('pointer-events','auto');

    const pills = rail.selectAll('button.pill')
      .data(cluster.pills || [], function(d){ return d.trait; });

    const enter = pills.enter().append('button')
      .attr('class','pill')
      .attr('title', function(d){
        // Always show both code and human-readable name on hover
        var code = d.trait;
        var name = d.fullName || endpointDisplayName(d.trait);
        if (d.isDrug) {
          // For drugs, display ATC mapped name (if available)
          name = displayEndpoint(d.trait, currentAtcMap, false);
        }
        return (name && name !== code) ? (name + ' — ' + code) : code;
      })
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
          .style('cursor', 'pointer');
      });

    enter.filter(function(d){ return !d.isDrug; })
      .on('click', function(d){
        if (window.d3 && d3.event && typeof d3.event.stopPropagation === 'function') {
          d3.event.stopPropagation();
        }
        selectEndpoint(d.trait);
      });

    // Drug pills: go to drugs portal for the ATC code
    enter.filter(function(d){ return d.isDrug; })
      .on('click', function(d){
        if (window.d3 && d3.event && typeof d3.event.stopPropagation === 'function') {
          d3.event.stopPropagation();
        }
        var code = d && d.trait ? d.trait : '';
        if (code) {
          var url = 'https://drugs.finngen.fi/pheno/' + code;
          if (window && typeof window.open === 'function') {
            window.open(url, '_blank');
          } else {
            window.location.href = url;
          }
        }
      });

    // Add expand/collapse toggle if multiple rows exist
    if (cluster.rowsCount && cluster.rowsCount > 1) {
      var isExpanded = expandedClusters.has(cluster.id);
      var toggle = rail.append('button')
        .attr('type', 'button')
        .attr('title', isExpanded ? 'Collapse' : 'Expand')
        .style('position','absolute')
        .style('right', '2px')
        .style('bottom', '2px')
        .style('width', '16px')
        .style('height', '16px')
        .style('line-height', '14px')
        .style('padding', '0')
        .style('border', '1px solid ' + theme.grid)
        .style('border-radius', '3px')
        .style('background', theme.bg)
        .style('color', theme.fg)
        .style('cursor', 'pointer')
        .style('z-index', 2)
        .text(isExpanded ? '▴' : '▾')
        .on('click', function(){
          if (window.d3 && d3.event && typeof d3.event.stopPropagation === 'function') {
            d3.event.stopPropagation();
          }
          if (expandedClusters.has(cluster.id)) {
            expandedClusters.delete(cluster.id);
          } else {
            expandedClusters.add(cluster.id);
          }
          drawUnique();
        });
    }
  }

  clusters.forEach(function(c,i){
    renderRail(c, layout.yPositions[i], width);
  });

  if (summaryEl) summaryEl.innerHTML = '';

  svg.select('g.x-axis').remove();
  // Build x-axis ticks to match LocusZoom style: Mb with two decimals, 0.05 Mb (50kb) increments
  function computeMbTicks(start, end) {
    var step = 50000; // 50kb
    var s = Math.ceil(start / step) * step;
    var e = Math.floor(end / step) * step;
    var vals = [];
    for (var v = s; v <= e; v += step) vals.push(v);
    return vals;
  }
  var axis = d3.axisBottom(x)
    .tickValues(computeMbTicks(regionStart, regionEnd))
    .tickFormat(function(d){ return (d/1e6).toFixed(2); });
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
  var epCodesToggle = document.getElementById('show-endpoint-codes');
  var dgToggle = document.getElementById('show-drugs');
  var lqToggle = document.getElementById('show-low-quality');
  var atcToggle = document.getElementById('show-atc-codes');
  var tolInput = document.getElementById('susie-tol');
  var topInRegionToggle = document.getElementById('susie-filter-top-in-region');

  if (epToggle) epToggle.addEventListener('change', renderFinnGenSusie);
  if (epCodesToggle) epCodesToggle.addEventListener('change', renderFinnGenSusie);
  if (dgToggle) dgToggle.addEventListener('change', renderFinnGenSusie);
  if (lqToggle) lqToggle.addEventListener('change', renderFinnGenSusie);
  if (atcToggle) atcToggle.addEventListener('change', renderFinnGenSusie);
  if (topInRegionToggle) topInRegionToggle.addEventListener('change', renderFinnGenSusie);
  if (tolInput) tolInput.addEventListener('input', drawUnique);

  document.addEventListener('pheweb:theme', drawUnique);

  // Ensure the SuSiE plot stays in sync with LocusZoom. Other plots
  // communicate zoom/pan events through LocusZoom by calling
  // `window.plot.applyState`, which emits a `state_changed` event. The
  // LocusZoom instance may load asynchronously, so keep trying until it
  // becomes available.
  (function attachLZSync(){
    function hook(){
      if (window.plot && window.plot.on) {
        window.plot.on('state_changed', function(){
          renderFinnGenSusie();
        });
        return true;
      }
      return false;
    }
    if (!hook()) {
      var retry = setInterval(function(){
        if (hook()) clearInterval(retry);
      }, 250);
    }
  })();

  // Handle page/window resize: re-render if width changed
  (function attachResizeHandler(){
    var timeoutId = null;
    window.addEventListener('resize', function(){
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(function(){
        var el = document.getElementById('finngen-susie');
        if (!el) return;
        var w = el.clientWidth || 0;
        if (drawUnique._prevWidth !== w) {
          drawUnique();
        }
      }, 150);
    });
  })();
});
