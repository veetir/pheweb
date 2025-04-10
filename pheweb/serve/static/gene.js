'use strict';

function populate_streamtable(data) {
  $(document).ready(function () {
    var table = $('#stream_table').DataTable({
      data: data,
      dom: 'lrtip',  // Custom layout: no default search box.
      paging: true,
      searching: true,
      info: false,
      ordering: true,
      columns: [
        {
          title: "Top p-value in gene",
          data: "assoc.pval",
          render: function (pval, type, row, meta) {
            return (pval === 0)
              ? '≤1e-320'
              : parseFloat(pval).toExponential(1);
          }
        },
        {
          title: "Phenotype",
          data: null,
          render: function (data, type, row, meta) {
            var phenoData = data.pheno;
            var label = phenoData.phenostring || phenoData.phenocode;
            if (phenoData.phenocode === window.pheno.phenocode) {
              return label;
            } else {
              var baseUrl = "{{ url_for('.region_page', phenocode='', region='').rstrip('/') }}";
              var url = baseUrl + "/" + phenoData.phenocode + "/gene/" + window.gene_symbol;
              return '<a style="color:black" href="' + url + '">' + label + '</a>';
            }
          }
        }
      ]
    });

    // For each row, set background or attach onclick handler based on phenotype match.
    table.rows().every(function () {
      var rowData = this.data();
      if (rowData.pheno.phenocode === window.pheno.phenocode) {
        $(this.node()).css("background-color", "lightblue");
      } else {
        $(this.node())
          .css("cursor", "pointer")
          .on("click", function () {
            var baseUrl = "{{ url_for('.region_page', phenocode='', region='').rstrip('/') }}";
            var url = baseUrl + "/" + rowData.pheno.phenocode + "/gene/" + window.gene_symbol;
            window.location = url;
          });
      }
    });
  });
}

populate_streamtable(window.significant_phenos);
