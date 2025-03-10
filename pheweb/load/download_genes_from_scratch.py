from ..utils import chrom_order, chrom_aliases, PheWebError
from ..file_utils import (
    get_tmp_path,
    make_basedir,
    genes_version,
    get_filepath,
    read_gzip,
)
from .. import conf

import os
import re
import csv
from collections import Counter
import wget
import boltons.iterutils
from typing import List, Dict, Any, Iterator, Tuple, Match


def re_search(pattern: str, string: str) -> Match[str]:
    m = re.search(pattern, string)
    if not m:
        raise Exception("re.search({}, {}) is None".format(repr(pattern), repr(string)))
    return m


# NOTE: to get all genetypes, run this:
#    zcat gencode-27.gtf.gz | grep -v '^#' | perl -F"\t" -nale 'print $F[8]=~m{gene_type "(.*?)"} if $F[2] eq "gene"' | sort | uniq -c
good_genetypes = set(
    """
protein_coding
IG_C_gene
IG_D_gene
IG_J_gene
IG_V_gene
TR_C_gene
TR_D_gene
TR_J_gene
TR_V_gene
""".split()
)
bad_genetypes = set(
    """
3prime_overlapping_ncRNA
antisense
bidirectional_promoter_lncRNA
lincRNA
lncRNA
macro_lncRNA
miRNA
misc_RNA
Mt_rRNA
Mt_tRNA
non_coding
processed_transcript
ribozyme
rRNA
scaRNA
scRNA
sense_intronic
sense_overlapping
snRNA
snoRNA
sRNA
TEC
vaultRNA
vault_RNA
""".split()
).union(good_genetypes)


def get_all_genes(gencode_filepath: str) -> Iterator[Dict[str, Any]]:
    with read_gzip(gencode_filepath) as f:
        for line in f:
            if line.startswith("#"):
                continue
            r = line.split("\t")
            if r[2] != "gene":
                continue

            try:
                if not r[0].startswith("chr"):
                    if r[0].startswith("GL"):
                        continue
                    else:
                        raise PheWebError(
                            "Unknown chromosome in gencode: {}".format(repr(r[0]))
                        )
                chrom = r[0][3:]
                if chrom in chrom_aliases:
                    chrom = chrom_aliases[chrom]
                elif chrom not in chrom_order:
                    continue
                pos1, pos2 = int(r[3]), int(r[4])
                assert pos1 < pos2
                full_ensg = re_search(r'gene_id "(ENSGR?[0-9\._A-Z]+?)"', r[8]).group(1)
                ensg = full_ensg.split(".")[0]
                symbol = re_search(r'gene_name "(.+?)"', r[8]).group(1)
                genetype = re_search(r'gene_type "(.+?)"', r[8]).group(1)
                # I don't want to deal with strange symbols, so replace them with the ENSG
                if not re.match(r"^[-_\.a-zA-Z0-9]+$", symbol):
                    if not symbol.startswith("HGNC:") and symbol != "THRA1/BTR":
                        print("Unexpected symbol format:", symbol, full_ensg, genetype)
                    symbol = ensg
            except Exception:
                raise PheWebError(
                    "Error while reading Gencode file on line:\n" + repr(r)
                )

            yield {
                "chrom": chrom,
                "start": pos1,
                "end": pos2,
                "symbol": symbol,
                "ensg": ensg,
                "full_ensg": full_ensg,
                "type": genetype,
            }


def get_good_genes(gencode_filepath: str) -> Iterator[Dict[str, Any]]:
    genes = list(get_all_genes(gencode_filepath))
    for gene in genes:
        if gene["type"] in good_genetypes:
            yield {k: v for k, v in gene.items() if k != "type"}
        elif "pseudogene" in gene["type"] or gene["type"] in bad_genetypes:
            continue
        else:
            # This genetype is not in the good or bad lists, so raise an exception
            genetype_counts = Counter(g["type"] for g in genes)
            unknown_genetype_counts = {
                gt: count
                for gt, count in genetype_counts.items()
                if gt not in good_genetypes
                and gt not in bad_genetypes
                and "pseudogene" not in gt
            }
            unseen_good_genetypes = {
                gt for gt in good_genetypes if genetype_counts[gt] == 0
            }
            unseen_bad_genetypes = {
                gt for gt in bad_genetypes if genetype_counts[gt] == 0
            }
            error_msg = (
                "Error: Unrecognized gene_types were seen in Gencode:\n"
                + "".join(
                    "   {:5} {}\n".format(count, gt)
                    for gt, count in unknown_genetype_counts.items()
                )
            )
            if unseen_good_genetypes:
                error_msg += "Unseen good gene_types were:\n" + "".join(
                    "   {}\n".format(gt) for gt in unseen_good_genetypes
                )
            if unseen_bad_genetypes:
                error_msg += "Unseen bad gene_types were:\n" + "".join(
                    "   {}\n".format(gt) for gt in unseen_bad_genetypes
                )
            raise PheWebError(error_msg)


def dedup_ensg(genes: Iterator[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    # If two genes share the same "ENSGXXXX" (before period), then use their "ENSGXXXX.XXX" instead.
    for ensg_group in boltons.iterutils.bucketize(
        genes, key=lambda g: g["ensg"]
    ).values():
        if len(ensg_group) == 1:
            yield ensg_group[0]
        else:
            # These are all pseudo-autosomals across X/Y
            assert sorted(g["chrom"] for g in ensg_group) == ["X", "Y"]
            for g in ensg_group:
                g["ensg"] = g["symbol"] = g["full_ensg"]
                yield g


def dedup_symbol(genes: Iterator[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    # If genes share the same SYMBOL, return the newer ENSG. In a tie, return the larger prefix.
    # so, ENSG01234.12_1 > ENSG01233.12_1 > ENSG01233.3_2 > ENSG01233.3
    def sortkey(g: Dict[str, Any]) -> Tuple[int, int, str]:
        m = re.match(r"ENSGR?([0-9]+)\.([0-9]+)(?:_([0-9]+))?", g["full_ensg"])
        if m is None:
            raise PheWebError("Error: cannot parse full_ensg: {}".format(repr(g)))
        return (
            int(m.group(2)),
            (0 if m.group(3) is None else int(m.group(3))),
            m.group(1),
        )

    for symbol_group in boltons.iterutils.bucketize(
        genes, key=lambda g: g["symbol"]
    ).values():
        if len(symbol_group) == 1:
            yield symbol_group[0]
        else:
            yield max(symbol_group, key=sortkey)


# def dedup_symbol(genes):
#     # If genes share the same SYMBOL, check that they are adjacent and then merge them
#     for symbol_group in boltons.iterutils.bucketize(genes, key=lambda g:g['symbol']).values():
#         if len(symbol_group) == 1:
#             yield symbol_group[0]
#         elif (boltons.iterutils.same(g['chrom'] for g in symbol_group) and
#               all(g1['end'] + 400e3 > g2['start'] for g1,g2 in boltons.iterutils.pairwise(sorted(symbol_group, key=lambda g:g['start'])))):
#             # 400kb is long enough to resolve all problems.
#             yield {
#                 'chrom': symbol_group[0]['chrom'],
#                 'start': min(g['start'] for g in symbol_group),
#                 'end': min(g['end'] for g in symbol_group),
#                 'symbol': symbol_group[0]['symbol'],
#                 'ensg': ','.join(g['ensg'] for g in symbol_group),
#             }
#         else:
#             raise PheWebError('Error while de-duping gene symbols from gencode:\n' +
#                               'Separate genes share a symbol:\n' +
#                               '\n'.join('- {:12,}\t{:12,}\t{}'.format(g['start'], g['end'], g) for g in symbol_group))


def download_genes_for_build(hg_build_number: int) -> None:

    raw_gencode_filepath = get_tmp_path(
        "gencode-v{}-hg{}.gtf.gz".format(genes_version, hg_build_number)
    )
    genes_filepath = get_filepath(
        "genes-hg{}".format(hg_build_number), must_exist=False
    )

    if not os.path.exists(genes_filepath):
        print("genes will be stored at {!r}".format(genes_filepath))
        if not os.path.exists(raw_gencode_filepath):
            # TODO: Tell the user if a newer release is available.
            if hg_build_number == 19:
                url = "http://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_human/release_{0}/GRCh37_mapping/gencode.v{0}lift37.annotation.gtf.gz".format(
                    genes_version
                )
            elif hg_build_number == 38:
                url = "http://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_human/release_{0}/gencode.v{0}.annotation.gtf.gz".format(
                    genes_version
                )
            else:
                raise Exception()
            print("Downloading from {}".format(url))
            make_basedir(raw_gencode_filepath)
            wget.download(url=url, out=raw_gencode_filepath)
            print("")
        genes_iter = get_good_genes(raw_gencode_filepath)
        genes_iter = dedup_ensg(genes_iter)
        genes = list(dedup_symbol(genes_iter))
        for g in genes:
            g.pop("full_ensg", None)

        genes_filepath_tmp = get_tmp_path(genes_filepath)
        make_basedir(genes_filepath)
        make_basedir(genes_filepath_tmp)
        with open(genes_filepath_tmp, "w") as f:
            writer = csv.DictWriter(
                f,
                delimiter="\t",
                fieldnames="chrom start end symbol ensg".split(),
                lineterminator="\n",
            )
            writer.writerows(genes)
        os.rename(genes_filepath_tmp, genes_filepath)

    else:
        print("gencode is at {!r}".format(genes_filepath))


def run(argv: List[str]) -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--hg", type=int, default=conf.get_hg_build_number(), choices=[19, 38]
    )
    args = parser.parse_args(argv)
    download_genes_for_build(args.hg)
