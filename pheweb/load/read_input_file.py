from ..utils import chrom_order, chrom_order_list, chrom_aliases, PheWebError
from .. import parse_utils
from .. import conf
from ..file_utils import read_maybe_gzip
from .load_utils import get_maf
from operator import itemgetter

import itertools
import re
import boltons.iterutils


class PhenoReader:
    """
    Reads variants (in order) and other info for a phenotype.
    It only returns variants that have a pvalue.
    If `minimum_maf` is defined, variants that don't meet that threshold (via MAF, AF, or AC/NS) are dropped.
    """

    def __init__(self, pheno, minimum_maf=0):
        self._pheno = pheno
        self._minimum_maf = minimum_maf or 0
        self.fields, self.filepaths = self._get_fields_and_filepaths(
            pheno["assoc_files"]
        )

    def get_variants(self):
        yield from self._order_refalt_lexicographically(
            itertools.chain.from_iterable(
                AssocFileReader(filepath, self._pheno).get_variants(
                    minimum_maf=self._minimum_maf
                )
                for filepath in self.filepaths
            )
        )

    def get_info(self):
        infos = [
            AssocFileReader(filepath, self._pheno).get_info()
            for filepath in self.filepaths
        ]
        for info in infos[1:]:
            if info != infos[0]:
                raise PheWebError(
                    "The pheno info parsed from some lines disagrees.\n"
                    + "- for the pheno {}\n".format(self._pheno["phenocode"])
                    + "- parsed from one line:\n    {}\n".format(infos[0])
                    + "- parsed another line:\n    {}\n".format(info)
                )
        return infos[0]

    def _validate_chrom_and_position_order(
        self,
        chrom_index: int,
        prev_chrom_index: int,
        chrom: str,
        pos: int,
        prev_pos: int,
        chrom_order_list: list,
    ):
        if chrom_index < prev_chrom_index:
            raise PheWebError(
                f"The chromosomes in your file appear to be in the wrong order.\n"
                f"The required order is: {chrom_order_list!r}\n"
                f"But in your file, the chromosome {chrom!r} came after the chromosome {chrom_order_list[prev_chrom_index]!r}\n"
            )

        if chrom_index == prev_chrom_index and pos < prev_pos:
            raise PheWebError(
                f"The positions in your file appear to be in the wrong order.\n"
                f"In your file, the position {pos!r} came after the position {prev_pos!r} on chromosome {chrom!r}\n"
            )

    def _order_refalt_lexicographically(self, variants):
        cp_groups = itertools.groupby(variants, key=lambda v: (v["chrom"], v["pos"]))
        prev_chrom_index, prev_pos = -1, -1
        for cp, tied_variants in cp_groups:
            chrom_index = self._get_chrom_index(cp[0])

            self._validate_chrom_and_position_order(
                chrom_index, prev_chrom_index, cp[0], cp[1], prev_pos, chrom_order_list
            )

            prev_chrom_index, prev_pos = chrom_index, cp[1]
            yield from sorted(tied_variants, key=itemgetter("ref", "alt"))

    def _get_fields_and_filepaths(self, filepaths):
        assoc_files = [{"filepath": filepath} for filepath in filepaths]
        for assoc_file in assoc_files:
            ar = AssocFileReader(assoc_file["filepath"], self._pheno)
            v = next(ar.get_variants())
            assoc_file["chrom"], assoc_file["pos"] = v["chrom"], v["pos"]
            assoc_file["fields"] = list(v)
        assert boltons.iterutils.same(af["fields"] for af in assoc_files)
        assoc_files = sorted(assoc_files, key=self._variant_chrpos_order_key)
        return (
            assoc_files[0]["fields"],
            [assoc_file["filepath"] for assoc_file in assoc_files],
        )

    @staticmethod
    def _variant_chrpos_order_key(v):
        return (PhenoReader._get_chrom_index(v["chrom"]), v["pos"])

    @staticmethod
    def _get_chrom_index(chrom):
        try:
            return chrom_order[chrom]
        except KeyError:
            raise PheWebError(
                "It looks like one of your variants has the chromosome {!r}, but PheWeb doesn't handle that chromosome.\n".format(
                    chrom
                )
                + "I bet you could fix it by running code like this on each of your input files:\n"
                + "zless my-input-file.tsv | perl -nale 'print if $. == 1 or m{^(1?[0-9]|2[0-2]|X|Y|MT?)\t}' | gzip > my-replacement-input-file.tsv.gz\n"
            )


class AssocFileReader:
    """
    Responsible for reading a single association file (e.g. .tsv/.txt/.csv).
    No concern for ordering across multiple files, that's PhenoReader's job.
    """

    def __init__(self, filepath, pheno):
        self.filepath = filepath
        self._pheno = pheno

    def get_variants(self, minimum_maf=0, use_per_pheno_fields=False):
        """
        Yields variants from a single association file, filtering out lines with
        no pval or with MAF < minimum_maf. If 'use_per_pheno_fields' is True,
        we parse only the per-phenotype fields from parse_utils.
        """
        with read_maybe_gzip(self.filepath) as f:
            header_line = self._read_first_line_or_fail(f)
            delimiter = self._guess_delimiter(header_line)

            colnames = self._parse_colnames(header_line, delimiter)
            colidx_for_field, marker_id_col = self._map_fields(
                colnames, use_per_pheno_fields
            )

            if use_per_pheno_fields:
                yield from self._yield_info_variants(
                    f, delimiter, colnames, colidx_for_field
                )
            else:
                yield from self._yield_main_variants(
                    f, delimiter, colnames, colidx_for_field, marker_id_col, minimum_maf
                )

    def _read_first_line_or_fail(self, f):
        """Reads the first line from file or raises a PheWebError if empty."""
        try:
            return next(f)
        except StopIteration:
            raise PheWebError(
                f"Failed to read from file {self.filepath} - is it empty?"
            )

    def _guess_delimiter(self, header_line: str) -> str:
        """Guess the delimiter from the header line based on heuristics."""
        if header_line.count("\t") >= 4:
            return "\t"
        elif header_line.count(" ") >= 4:
            return " "
        elif header_line.count(",") >= 4:
            return ","
        else:
            raise PheWebError(
                f"Cannot guess what delimiter to use to parse the header line {header_line!r} "
                f"in file {self.filepath!r}"
            )

    def _parse_colnames(self, header_line: str, delimiter: str):
        """Split the header line by delimiter, normalize column names to lower case."""
        # e.g. "chrom", "pos", "pval", ...
        return [
            colname.strip("\"' ").lower()
            for colname in header_line.rstrip("\n\r").split(delimiter)
        ]

    def _map_fields(self, colnames, use_per_pheno_fields: bool):
        """
        Create a colidx_for_field mapping from fieldname -> column_index,
        plus handle marker_id special case.
        """
        if use_per_pheno_fields:
            fieldnames_to_check = [
                fieldname
                for fieldname, fieldval in parse_utils.per_pheno_fields.items()
                if fieldval["from_assoc_files"]
            ]
        else:
            fieldnames_to_check = [
                fieldname
                for fieldname, fieldval in itertools.chain(
                    parse_utils.per_variant_fields.items(),
                    parse_utils.per_assoc_fields.items(),
                )
                if fieldval["from_assoc_files"]
            ]

        colidx_for_field = self._parse_header(colnames, fieldnames_to_check)

        # Handle `MARKER_ID` special case
        marker_id_col = None
        if "marker_id" in colnames:
            marker_id_col = colnames.index("marker_id")
            # We artificially set ref/alt colidx to None so we do not parse them from columns
            colidx_for_field["ref"] = None
            colidx_for_field["alt"] = None

        self._assert_all_fields_mapped(colnames, fieldnames_to_check, colidx_for_field)

        return colidx_for_field, marker_id_col

    def _yield_info_variants(self, f, delimiter, colnames, colidx_for_field):
        """
        This yields 'info' lines for the 'use_per_pheno_fields' path.
        We don't filter or skip lines, so we parse each line as a variant dict.
        """
        for line in f:
            values = line.rstrip("\n\r").split(delimiter)
            yield self._parse_variant(values, colnames, colidx_for_field)

    def _yield_main_variants(
        self, f, delimiter, colnames, colidx_for_field, marker_id_col, minimum_maf
    ):
        """
        Main path for actual variant data. Skips lines with no pval,
        or MAF < minimum_maf, or modifies chrom/ref/alt from marker_id.
        """
        for line in f:
            values = line.rstrip("\n\r").split(delimiter)
            variant = self._parse_variant(values, colnames, colidx_for_field)

            if variant["pval"] == "":
                continue

            maf = get_maf(variant, self._pheno)  # checks for agreement
            if maf is not None and maf < minimum_maf:
                continue

            if marker_id_col is not None:
                chrom2, pos2, ref2, alt2 = self.parse_marker_id(values[marker_id_col])
                assert variant["chrom"] == chrom2, (values, variant, chrom2)
                assert variant["pos"] == pos2, (values, variant, pos2)
                variant["ref"] = ref2
                variant["alt"] = alt2

            if variant["chrom"] in chrom_aliases:
                variant["chrom"] = chrom_aliases[variant["chrom"]]

            yield variant

    def _parse_variant(self, values, colnames, colidx_for_field):
        """
        Create a dictionary of field -> parsed_value for one line.
        """
        if len(values) != len(colnames):
            raise self._raise_bad_line_error(values, colnames)

        variant = {}
        for field, colidx in colidx_for_field.items():
            if colidx is not None:
                parse = parse_utils.parser_for_field[field]
                raw_val = values[colidx]
                try:
                    variant[field] = parse(raw_val)
                except Exception as exc:
                    raise PheWebError(
                        f"failed on field {field!r} attempting to convert value {raw_val!r} to "
                        f"type {parse_utils.fields[field]['type']!r} with constraints {parse_utils.fields[field]!r} "
                        f"in {self.filepath!r} on line with values {values!r} given colnames {colnames!r} "
                        f"and field mapping {colidx_for_field!r}"
                    ) from exc

        return variant

    def _raise_bad_line_error(self, values, colnames):
        """
        Helper to raise a PheWebError with a truncated message if lines are huge.
        """
        repr_values = repr(values)
        if len(repr_values) > 5000:
            repr_values = f"{repr_values[:200]} ... {repr_values[-200:]}"
        return PheWebError(
            f"ERROR: A line has {len(values)!r} values, but we expected {len(colnames)!r}.\n"
            f"- The line: {repr_values}\n"
            f"- The header: {colnames!r}\n"
            f"- In file: {self.filepath!r}\n"
        )

    def _parse_header(self, colnames, fieldnames_to_check):
        colidx_for_field = {}
        field_aliases = conf.get_field_aliases()  # {alias: field_name}
        for colidx, colname in enumerate(colnames):
            if (
                colname in field_aliases
                and field_aliases[colname] in fieldnames_to_check
            ):
                field_name = field_aliases[colname]
                if field_name in colidx_for_field:
                    raise PheWebError(
                        f"PheWeb found two ways of mapping the field_name {field_name!r} "
                        f"to columns {colnames!r}.\nfield_aliases = {field_aliases!r}.\n"
                        f"File = {self.filepath}\n"
                    )
                colidx_for_field[field_name] = colidx
        return colidx_for_field

    def _assert_all_fields_mapped(
        self, colnames, fieldnames_to_check, colidx_for_field
    ):
        fields = parse_utils.fields
        required_fieldnames = [
            fn for fn in fieldnames_to_check if fields[fn]["required"]
        ]
        missing_required_fieldnames = [
            fn for fn in required_fieldnames if fn not in colidx_for_field
        ]
        if missing_required_fieldnames:
            err_message = (
                f"Some required fields weren't mapped to columns in file {self.filepath!r}.\n"
                f"The fields that were required but not present are: {missing_required_fieldnames!r}\n"
                f"field_aliases = {conf.get_field_aliases()}:\n"
                f"Here are all the column names from that file: {colnames!r}\n"
            )
            if colidx_for_field:
                err_message += (
                    "Here are the fields that successfully mapped:\n"
                    + "".join(
                        f"- {field}: {colnames[idx]} (column #{idx})\n"
                        for field, idx in colidx_for_field.items()
                    )
                )
            else:
                err_message += "No fields successfully mapped.\n"
            err_message += "You need to modify your input files or set field_aliases in your `config.py`."
            raise PheWebError(err_message)

    @staticmethod
    def parse_marker_id(marker_id):
        match = AssocFileReader.parse_marker_id_regex.match(marker_id)
        if match is None:
            raise PheWebError(
                f"ERROR: MARKER_ID didn't match our MARKER_ID pattern: {marker_id!r}"
            )
        chrom, pos, ref, alt = match.groups()
        return chrom, int(pos), ref, alt

    parse_marker_id_regex = re.compile(r"([^:]+):([0-9]+)_([-ATCG\.]+)/([-ATCG\.\*]+)")
