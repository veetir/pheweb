'use strict';

function populate_streamtable(phenotypes) {
  $(document).ready(function() {
    var data = phenotypes;
    var table = $('#stream_table').DataTable({
      data: data,
      dom: 'lrtip',
      columns: [
        {
          data: 'category',
          title: 'Category'
        },
        {
          data: null,
          title: 'Phenotype',
          render: function(data, type, row, meta) {
            var label = data.phenostring || data.phenocode;
            return '<a style="color:black" href="' + window.model.urlprefix + '/pheno/' + data.phenocode + '">' +
                     label +
                   '</a>';
          }
        },
        {
          data: 'gc_lambda_hundred',
          title: 'GCλ0.01',
          render: function(data, type, row, meta) {
            return (data !== null) ? parseFloat(data).toFixed(2) : '';
          }
        },
        {
          data: 'num_peaks',
          title: '#Loci<5e-8'
        },
        {
          data: null,
          title: 'Top variant in pheno',
          render: function(data, type, row, meta) {
            var variantText = data.chrom + ':' + data.pos.toLocaleString() + ' ' +
                              data.ref + ' / ' + data.alt;
            if (data.rsids) {
              variantText += ' (' + data.rsids.split(',').join(', ') + ')';
            }
            return '<a style="color:black" href="' + window.model.urlprefix + '/variant/' +
                   data.chrom + '-' + data.pos + '-' + data.ref + '-' + data.alt + '">' +
                   variantText +
                   '</a>';
          }
        },
        {
          data: 'pval',
          title: 'P-value',
          render: function(data, type, row, meta) {
            return (data === 0) ? '≤1e-320' : parseFloat(data).toExponential(1);
          }
        },
        {
          data: 'nearest_genes',
          title: 'Nearest Gene(s)',
          render: function(data, type, row, meta) {
            var genes = data.split(",");
            return genes.map(function(gene) {
              return '<a style="color:black" href="' + window.model.urlprefix +
                     '/gene/' + gene + '?include=' + row.chrom + '-' + row.pos + '">' +
                     '<i>' + gene + '</i></a>';
            }).join(', ');
          }
        }
      ],
      paging: true,
      searching: true,
      info: true,
      drawCallback: function(settings) {
        var api = this.api();
        var totalRows = api.rows().count();
        var filteredRows = api.rows({ filter: 'applied' }).count();
        var count = $.trim($('#search').val()) !== "" ? filteredRows : totalRows;
        var text = count + " " + (count === 1 ? "phenotype" : "phenotypes");
        $('#streamtable-found').text(text);
      }
    });
    $('#search').on('keyup', function() {
      table.search(this.value).draw();
    });
  });
}
