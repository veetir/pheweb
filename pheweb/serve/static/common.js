'use strict';

window.debug = window.debug || {};

// Theme handling
(function() {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function getStored() {
        return localStorage.getItem('theme') || 'auto';
    }

    function preferred(theme) {
        if (theme === 'auto') {
            return media.matches ? 'dark' : 'light';
        }
        return theme;
    }

    function apply(theme) {
        document.documentElement.setAttribute('data-bs-theme', preferred(theme));
    }

    function updateIcon(theme) {
        const icon = document.getElementById('theme-toggle-icon');
        if (!icon) return;
        icon.classList.remove('bi-circle-half', 'bi-moon-fill', 'bi-sun-fill');
        if (theme === 'auto') icon.classList.add('bi-circle-half');
        else if (theme === 'dark') icon.classList.add('bi-moon-fill');
        else icon.classList.add('bi-sun-fill');
    }

    function setTheme(theme) {
        localStorage.setItem('theme', theme);
        apply(theme);
        updateIcon(theme);
    }

    function cycle() {
        const order = ['auto', 'dark', 'light'];
        const current = getStored();
        const next = order[(order.indexOf(current) + 1) % order.length];
        setTheme(next);
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateIcon(getStored());
        const btn = document.getElementById('theme-toggle');
        if (btn) btn.addEventListener('click', cycle);
    });

    media.addEventListener('change', () => {
        if (getStored() === 'auto') apply('auto');
    });

    // expose for debugging if needed
    window.phewebTheme = {getStored, setTheme};
})();

// deal with IE11 problems
if (!Math.log10) { Math.log10 = function(x) { return Math.log(x) / Math.LN10; }; }
if (!!window.MSInputMethodContext && !!document.documentMode) { /*ie11*/ $('<style type=text/css>.lz-locuszoom {height: 400px;}</style>').appendTo($('head')); }
if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    'use strict';
    if (typeof start !== 'number') {
      start = 0;
    }
    if (start + search.length > this.length) {
      return false;
    } else {
      return this.indexOf(search, start) !== -1;
    }
  };
}


(function() {
    // It's unfortunate that these are hard-coded, but it works pretty great, so I won't change it now.
    var autocomplete_bloodhound = new Bloodhound({
        datumTokenizer: Bloodhound.tokenizers.obj.whitespace('display'),
        queryTokenizer: Bloodhound.tokenizers.whitespace,
        identify: function(sugg) { return sugg.display; }, // maybe allows Bloodhound to `.get()`  objects
        remote: {
            url: window.model.urlprefix + '/api/autocomplete?query=%QUERY',
            wildcard: '%QUERY',
            rateLimitBy: 'throttle',
            rateLimitWait: 100,
        },
    });

    $(function() {
        $('.typeahead').typeahead({
            hint: false,
            highlight: true,
            minLength: 1,
        }, {
            name: 'autocomplete',
            source: autocomplete_bloodhound,
            display: 'value',
            limit: 100,
            templates: {
                suggestion: _.template("<div><%= display %></div>"),
                empty: "<div class='tt-empty-message'>No matches found.</div>"
            }
        });

        $('.typeahead').bind('typeahead:select', function(ev, suggestion) {
            window.location.href = suggestion.url;
        });
    });
})();


// convenience functions
function fmt(format) {
    var args = Array.prototype.slice.call(arguments, 1);
    return format.replace(/{(\d+)}/g, function(match, number) {
        return (typeof args[number] != 'undefined') ? args[number] : match;
    });
}

function two_digit_format(x) { return (x>=.1)? x.toFixed(2) : (x>=.01)? x.toFixed(3) : x.toExponential(1); }
