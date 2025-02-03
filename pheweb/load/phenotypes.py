
from ..utils import get_phenolist
from ..file_utils import write_json, get_filepath, get_pheno_filepath, write_heterogenous_variantfile

import json
from pathlib import Path
from typing import Iterator,Dict,Any,List

def get_phenotypes_including_top_variants() -> Iterator[Dict[str,Any]]:
    for pheno in get_phenolist():
        # Try to load the QQ file; if it doesn't exist or is invalid, use a default value.
        qq_filepath = get_pheno_filepath('qq', pheno['phenocode'])
        gc_lambda_hundred = None
        try:
            with open(qq_filepath) as f:
                qq_data = json.load(f)
                # Check that the expected keys exist.
                if 'overall' in qq_data and 'gc_lambda' in qq_data['overall']:
                    gc_lambda_hundred = qq_data['overall']['gc_lambda'].get('0.01', None)
        except Exception as e:
            # Could log the error here if desired.
            gc_lambda_hundred = None

        # Load the manhattan file as before.
        with open(get_pheno_filepath('manhattan', pheno['phenocode'])) as f:
            variants = json.load(f)['unbinned_variants']
        top_variant = min(variants, key=lambda v: v['pval'])
        num_peaks = sum(variant.get('peak', False) and variant['pval'] <= 5e-8 for variant in variants)
        ret = {
            'phenocode': pheno['phenocode'],
            'pval': top_variant['pval'],
            'nearest_genes': top_variant['nearest_genes'],
            'chrom': top_variant['chrom'],
            'pos': top_variant['pos'],
            'ref': top_variant['ref'],
            'alt': top_variant['alt'],
            'rsids': top_variant['rsids'],
            'num_peaks': num_peaks,
            'gc_lambda_hundred': gc_lambda_hundred,  # numbers in keys break streamtable
        }
        for key in ['num_samples', 'num_controls', 'num_cases', 'category', 'phenostring']:
            if key in pheno:
                ret[key] = pheno[key]
        if isinstance(ret['nearest_genes'], list):
            ret['nearest_genes'] = ','.join(ret['nearest_genes'])
        yield ret

def should_run() -> bool:
    output_filepaths = [Path(get_filepath(name, must_exist=False)) for name in ['phenotypes_summary', 'phenotypes_summary_tsv']]
    if not all(fp.exists() for fp in output_filepaths):
        return True
    oldest_output_mtime = min(fp.stat().st_mtime for fp in output_filepaths)
    input_filepaths = [Path(get_pheno_filepath('manhattan', pheno['phenocode'])) for pheno in get_phenolist()]
    newest_input_mtime = max(fp.stat().st_mtime for fp in input_filepaths)
    if newest_input_mtime > oldest_output_mtime:
        return True
    return False

def run(argv:List[str]) -> None:
    if '-h' in argv or '--help' in argv:
        print('Make a file summarizing information about each phenotype (for use in the phenotypes table)')
        exit(1)

    if not should_run():
        print('Already up-to-date!')
        return

    data = sorted(get_phenotypes_including_top_variants(), key=lambda p: p['pval'])

    out_filepath = get_filepath('phenotypes_summary', must_exist=False)
    write_json(filepath=out_filepath, data=data)
    print("wrote {} phenotypes to {}".format(len(data), out_filepath))

    out_filepath_tsv = get_filepath('phenotypes_summary_tsv', must_exist=False)
    write_heterogenous_variantfile(out_filepath_tsv, data, use_gzip=False)
    print("wrote {} phenotypes to {}".format(len(data), out_filepath_tsv))
