'use strict';

// Get the built‐in association adapter.
const AssociationLZ = LocusZoom.Adapters.get('AssociationLZ');

// Create your custom adapter by subclassing the built‐in adapter.
class AssociationPheWeb extends AssociationLZ {
    // Override the URL-building method.
    _getURL(request_options) {
        const { chr, start, end } = request_options;
        // Use this.config.url (the adapter configuration) to get the base URL.
        const base = this.config && this.config.url ? this.config.url : "";
        return `${base}results/?filter=chromosome in '${chr}' and position ge ${start} and position le ${end}`;
    }

    // Optionally override record annotation if you need custom processing.
    _annotateRecords(records, options) {
        return super._annotateRecords(records, options);
    }

    // Override normalization so that empty responses are handled gracefully.
    _normalizeResponse(raw_response, options) {
        if (!raw_response || !Object.keys(raw_response).length) {
            return [];
        }
        return super._normalizeResponse(raw_response, options);
    }
}

// Register your custom adapter.
LocusZoom.Adapters.add('AssociationPheWeb', AssociationPheWeb);

// Transformation functions.
LocusZoom.TransformationFunctions.add("percent", function(x) {
    if (x === 1) { return "100%"; }
    x = (x * 100).toPrecision(2);
    if (x.indexOf('.') !== -1) { x = x.replace(/0+$/, ''); }
    if (x.endsWith('.')) { x = x.substr(0, x.length - 1); }
    return x + '%';
});

LocusZoom.TransformationFunctions.add("neglog10_or_323", function(x) {
    if (x === 0) return 323;
    return -Math.log(x) / Math.LN10;
});

(function() {
    // Define the URL bases.
    var localBase = window.model.urlprefix + "/api/region/" + window.pheno.phenocode + "/lz-";
    var remoteBase = "https://portaldev.sph.umich.edu/api/v1/";
    
    // Define LocusZoom Data Sources.
    // All extra options (e.g. build, source) are now specified as top-level keys.
    var data_sources = new LocusZoom.DataSources()
        .add("assoc", ["AssociationPheWeb", { url: localBase }])
        .add("catalog", ["GwasCatalogLZ", { 
            url: remoteBase + 'annotation/gwascatalog/results/', 
            build: "GRCh" + window.model.grch_build_number 
        }])
        .add("ld", ["LDServer", { 
            url: "https://portaldev.sph.umich.edu/ld/",
            source: '1000G', 
            build: 'GRCh' + window.model.grch_build_number, 
            population: 'ALL' 
        }])
        .add("gene", ["GeneLZ", { 
            url: remoteBase + "annotation/genes/", 
            build: 'GRCh' + window.model.grch_build_number 
        }])
        .add("recomb", ["RecombLZ", { 
            url: remoteBase + "annotation/recomb/results/", 
            build: 'GRCh' + window.model.grch_build_number 
        }])
        .add("constraint", ["GeneConstraintLZ", { 
            url: "https://gnomad.broadinstitute.org/api/", 
            build: 'GRCh' + window.model.grch_build_number 
        }]);

    // Toolbar Widgets helper function.
    function add_toolbar_button(name, click_handler) {
        LocusZoom.Widgets.extend('BaseWidget', name, {
            update() {
                if (this.button) return this;
                this.button = new (LocusZoom.Widgets.get('_Button'))(this)
                    .setColor(this.layout.color)
                    .setHtml(this.layout.text)
                    .setTitle(this.layout.title)
                    .setOnclick(click_handler.bind(this));
                this.button.show();
                return this.update();
            }
        });
    }

    add_toolbar_button('link', function() {
        window.location.href = this.layout.url;
    });

    add_toolbar_button('move', function() {
        var start = this.parent_plot.state.start;
        var end = this.parent_plot.state.end;
        var shift = Math.floor(end - start) * this.layout.direction;
        this.parent_plot.applyState({
            chr: this.parent_plot.state.chr,
            start: start + shift,
            end: end + shift
        });
    });

    // Define the layout using the new namespacing syntax (e.g. "assoc:id" rather than the old templating).
    var layout = LocusZoom.Layouts.get("plot", "association_catalog", {
        width: 800,
        responsive_resize: true,
        max_region_scale: 500e3,
        toolbar: {
            widgets: [{
                type: 'link',
                title: 'Go to Manhattan Plot',
                text: ' Manhattan Plot',
                url: window.model.urlprefix + '/pheno/' + window.pheno.phenocode,
                position: 'left'
            }, {
                type: 'move',
                text: '<<',
                title: 'Shift view 1/4 to the left',
                direction: -0.75,
                group_position: "start"
            }, {
                type: 'move',
                text: '<',
                title: 'Shift view 1/4 to the left',
                direction: -0.25,
                group_position: "middle"
            }, {
                type: 'zoom_region',
                button_html: 'z+',
                title: 'Zoom in 2x',
                step: -0.5,
                group_position: "middle"
            }, {
                type: 'zoom_region',
                button_html: 'z-',
                title: 'Zoom out 2x',
                step: 1,
                group_position: "middle"
            }, {
                type: 'move',
                text: '>',
                title: 'Shift view 1/4 to the right',
                direction: 0.25,
                group_position: "middle"
            }, {
                type: 'move',
                text: '>>',
                title: 'Shift view 3/4 to the right',
                direction: 0.75,
                group_position: "end"
            }, {
                type: 'download',
                position: 'right'
            }, {
                type: 'download_png',
                position: 'right'
            }, LocusZoom.Layouts.get('toolbar_widgets', 'ldlz2_pop_selector')]
        },
        panels: [
            // Panel 1: GWAS Catalog annotations.
            (function() {
                var base = LocusZoom.Layouts.get("panel", "annotation_catalog", {
                    height: 52,
                    min_height: 52,
                    margin: { top: 30, bottom: 13 },
                    toolbar: { widgets: [] },
                    axes: { x: { render: false, extent: 'state' } },
                    title: {
                        text: 'Hits in GWAS Catalog',
                        style: { 'font-size': '14px' },
                        x: 50
                    }
                });
                var anno_layer = base.data_layers[0];
                anno_layer.id_field = "assoc:id";
                anno_layer.fields = [
                    "assoc:id",
                    "assoc:chr", "assoc:position",
                    "catalog:variant", "catalog:rsid", "catalog:trait", "catalog:log_pvalue"
                ];
                anno_layer.hit_area_width = 50;
                return base;
            })(),
            // Panel 2: Association and Catalog data.
            (function() {
                var base = LocusZoom.Layouts.get("panel", "association_catalog", {
                    height: 200,
                    min_height: 200,
                    margin: { top: 10 },
                    toolbar: {
                        widgets: [
                            { type: "toggle_legend", position: "right", color: "green" },
                            {
                                type: "display_options",
                                position: "right",
                                color: "blue",
                                button_html: "Display options...",
                                button_title: "Control how plot items are displayed",
                                layer_name: "associationpvaluescatalog",
                                default_config_display_name: "No catalog labels (default)",
                                options: [{
                                    display_name: "Label catalog traits",
                                    display: {
                                        label: {
                                            text: "catalog:trait",
                                            spacing: 6,
                                            lines: { style: { "stroke-width": "2px", "stroke": "#333333", "stroke-dasharray": "2px 2px" } },
                                            filters: [
                                                { field: "catalog:trait", operator: "!=", value: null },
                                                { field: "catalog:log_pvalue", operator: ">", value: 7.301 },
                                                { field: "ld:state", operator: ">", value: 0.4 }
                                            ],
                                            style: { "font-size": "10px", "font-weight": "bold", "fill": "#333333" }
                                        }
                                    }
                                }]
                            }
                        ]
                    },
                    data_layers: [
                        LocusZoom.Layouts.get("data_layer", "significance"),
                        LocusZoom.Layouts.get("data_layer", "recomb_rate"),
                        (function() {
                            var l = LocusZoom.Layouts.get("data_layer", "association_pvalues_catalog", {
                                fields: [
                                    "assoc:all",
                                    "assoc:id",
                                    "assoc:position",
                                    "assoc:pvalue|neglog10_or_323",
                                    "ld:state", "ld:isrefvar",
                                    "catalog:rsid", "catalog:trait", "catalog:log_pvalue"
                                ],
                                id_field: "assoc:id",
                                tooltip: {
                                    closable: true,
                                    show: { "or": ["highlighted", "selected"] },
                                    hide: { "and": ["unhighlighted", "unselected"] },
                                    html: "<strong>{{assoc:id}}</strong><br><br>" +
                                          window.model.tooltip_lztemplate +
                                          "<br>" +
                                          "<a href=\"" + window.model.urlprefix + "/variant/{{assoc:chr}}-{{assoc:position}}-{{assoc:ref}}-{{assoc:alt}}\">Go to PheWAS</a>" +
                                          "{{#if catalog:rsid}}<br><a href=\"https://www.ebi.ac.uk/gwas/search?query={{catalog:rsid}}\" target=\"_new\">See hits in GWAS catalog</a>{{/if}}" +
                                          "<br>{{#if ld:isrefvar}}<strong>LD Reference Variant</strong>{{#else}}<a href=\"javascript:void(0);\" onclick=\"var data = this.parentNode.__data__;data.getDataLayer().makeLDReference(data);\">Make LD Reference</a>{{/if}}<br>"
                                },
                                x_axis: { field: "assoc:position" },
                                y_axis: {
                                    axis: 1,
                                    field: "assoc:pvalue|neglog10_or_323",
                                    floor: 0,
                                    upper_buffer: 0.1,
                                    min_extent: [0, 10]
                                }
                            });
                            l.behaviors.onctrlclick = [{
                                action: "link",
                                href: window.model.urlprefix + "/variant/{{assoc:chr}}-{{assoc:position}}-{{assoc:ref}}-{{assoc:alt}}"
                            }];
                            return l;
                        })()
                    ]
                });
                base.legend.origin.y = 15;
                return base;
            })(),
            // Panel 3: Genes.
            LocusZoom.Layouts.get("panel", "genes", {
                toolbar: {
                    widgets: [
                        { type: "resize_to_data", position: "right", color: "blue" },
                        LocusZoom.Layouts.get('toolbar_widgets', 'gene_selector_menu')
                    ]
                },
                data_layers: [
                    LocusZoom.Layouts.get("data_layer", "genes_filtered", {
                        fields: ["gene:all"],
                        tooltip: {
                            html: "<h4><strong><i>{{gene:gene_name}}</i></strong></h4>" +
                                  "<div>Gene ID: <strong>{{gene:gene_id}}</strong></div>" +
                                  "<div>Transcript ID: <strong>{{gene:transcript_id}}</strong></div>" +
                                  "<div style=\"clear: both;\"></div>" +
                                  "<table width=\"100%\"><tr><td style=\"text-align: right;\"><a href=\"http://gnomad.broadinstitute.org/gene/{{gene:gene_id}}\" target=\"_new\">More data on gnomAD/ExAC</a> and " +
                                  "<a href=\"http://bravo.sph.umich.edu/freeze5/hg38/gene/{{gene:gene_id}}\" target=\"_new\">Bravo</a></td></tr></table>"
                        }
                    })
                ]
            })
        ]
    });
    LocusZoom.Layouts.add("plot", "pheweb_association", layout);
    layout = LocusZoom.Layouts.get("plot", "pheweb_association");

    $(function() {
        window.plot = LocusZoom.populate("#lz-1", data_sources, layout);
        window.plot.state.genome_build = 'GRCh' + window.model.grch_build_number;

        (function() {
            var doubleclick_delay_ms = 400;
            var previous_data, previous_milliseconds = 0;
            window.plot.panels.associationcatalog.on('element_clicked', function(obj) {
                var data = obj.data, milliseconds = Date.now();
                if ((data === previous_data) && (milliseconds - previous_milliseconds < doubleclick_delay_ms)) {
                    window.location.href = window.model.urlprefix + "/variant/" +
                        data["assoc:chr"] + "-" + data["assoc:position"] + "-" +
                        data["assoc:ref"] + "-" + data["assoc:alt"];
                }
                previous_data = data;
                previous_milliseconds = milliseconds;
            });
        })();
    });
})();
