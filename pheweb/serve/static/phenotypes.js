'use strict';

function populate_streamtable(phenotypes) {
    $(function() {
        // This is mostly copied from <https://michigangenomics.org/health_data.html>.
        var data = phenotypes;
        // data = _.sortBy(data, _.property('pval'));
        var template = _.template($('#streamtable-template').html());
        var view = function(pheno) {
            return template({h: pheno});
        };
        var $found = $('#streamtable-found');
        var count = data.length;
        $found.text(count + (count === 1 ? " phenotype" : " phenotypes"));

        var callbacks = {
            pagination: function(summary){
                var text;
                if ($.trim($('#search').val()).length > 0){
                    text = summary.total + (summary.total === 1 ? " matching phenotype" : " matching phenotypes");
                } else {
                    text = count + (count === 1 ? " phenotype" : " phenotypes");
                }
                $found.text(text);
                patchPaginationMarkup();
            }
        }

        var options = {
            view: view,
            search_box: '#search',
            callbacks: callbacks,
            pagination: {
                span: 5,
                next_text: 'Next <i class="bi bi-arrow-right"></i>',
                prev_text: '<i class="bi bi-arrow-left"></i> Previous',
                per_page_select: false,
                per_page_opts: [100]
            }
        }

        function patchPaginationMarkup() {
            $('.st_pagination').find('ul.pagination').each(function() {
                $(this).find('li').each(function() {
                    $(this).addClass('page-item');
                    const $a = $(this).find('a');
                    if ($a.length) {
                        $a.addClass('page-link');
                        if ($a.hasClass('active')) {
                            $a.removeClass('active');
                            $(this).addClass('active');
                        }
                    }
                });
            });
        }
        
        $('#stream_table').stream_table(options, data);
        patchPaginationMarkup();
    });
}

