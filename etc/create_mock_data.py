#!/usr/bin/env python3
"""Create a tiny mock dataset for building a demo PheWeb site.

This script writes a minimal set of association results and accompanying
metadata into an output directory.  The resulting directory can be used as
`data_dir` for `pheweb` commands.
"""

import os
import pathlib

VARIANTS = [
    ("G", "A", 869334, 1, 0.1, 2e-6),
    ("T", "C", 1930553, 1, 0.1, 2e-4),
    ("A", "T", 1931299, 1, 0.5, 3e-11),
    ("G", "C", 1932181, 1, 0.04, 1e-12),
    ("G", "C", 1935075, 1, 0.5, 6e-8),
]


def write_assoc_file(outdir: pathlib.Path) -> None:
    assoc_dir = outdir / "assoc-files"
    assoc_dir.mkdir(parents=True, exist_ok=True)
    assoc_path = assoc_dir / "demo.tsv"
    with assoc_path.open("w") as f:
        f.write("ref\talt\tbeg\tchrom\tmaf\tpval\n")
        for ref, alt, beg, chrom, maf, pval in VARIANTS:
            f.write(f"{ref}\t{alt}\t{beg}\t{chrom}\t{maf}\t{pval}\n")


def write_categories(outdir: pathlib.Path) -> None:
    with (outdir / "categories.csv").open("w") as f:
        f.write("phenocode,category\n")
        f.write("demo,Demo\n")


def write_correlations(outdir: pathlib.Path) -> None:
    with (outdir / "pheno-correlations.txt").open("w") as f:
        f.write("Trait1\tTrait2\trg\tSE\tZ\tP-value\tMethod\n")
        f.write("demo\tdemo\t1\t0\t0\t0\tmock\n")


def main(outdir: str) -> None:
    outpath = pathlib.Path(outdir)
    outpath.mkdir(parents=True, exist_ok=True)
    write_assoc_file(outpath)
    write_categories(outpath)
    write_correlations(outpath)
    print(f"Mock data written to {outpath}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "outdir", nargs="?", default="mock-data", help="output directory for mock data"
    )
    args = parser.parse_args()
    main(args.outdir)
