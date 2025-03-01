from ..file_utils import get_filepath
from .server_utils import parse_variant

from flask import url_for

import urllib.parse
import itertools
import re
import copy
import sqlite3
from typing import List, Dict, Any, Optional, Iterator

# TODO: sort suggestions better.
# - It's good that hitting enter sends you to the thing with the highest token-ratio.
# - But it's not good that that's not the first thing in the autocomplete suggestions.
# - Solution:
#     - for rsid and variant, the list should be sorted first by length.
#     - for stringy things, the list should be sorted by token-match-ratio.  That's gonna suck to implement in javascript.
#         - Could we send token-sort-ratio along and tell typeaheadjs to sort on it? No, b/c the query changes.
#         - but, stringy things should just be in a streamtable anyways.


def get_sqlite3_readonly_connection(filepath: str):
    # `check_same_thread=False` lets WSGI work. Readonly makes me feel better about disabling `check_same_thread`.
    return sqlite3.connect(
        "file:{}?mode=ro".format(urllib.parse.quote(filepath)),
        uri=True,
        check_same_thread=False,
    )


class Autocompleter(object):
    def __init__(self, phenos: Dict[str, Dict[str, Any]]):
        self._phenos = copy.deepcopy(phenos)
        self._preprocess_phenos()

        self._cpras_rsids_sqlite3 = get_sqlite3_readonly_connection(
            get_filepath("cpras-rsids-sqlite3")
        )
        self._cpras_rsids_sqlite3.row_factory = sqlite3.Row
        self._gene_aliases_sqlite3 = get_sqlite3_readonly_connection(
            get_filepath("gene-aliases-sqlite3")
        )
        self._gene_aliases_sqlite3.row_factory = sqlite3.Row

        self._autocompleters = [
            self._autocomplete_rsid,  # Check rsid first, because it only runs if query.startswith('rs')
            self._autocomplete_variant,  # Check variant next, because it only runs if query starts with a chrom alias.
            self._autocomplete_phenocode,
            self._autocomplete_gene,
        ]
        if any("phenostring" in pheno for pheno in self._phenos.values()):
            self._autocompleters.append(self._autocomplete_phenostring)

    def autocomplete(self, query: str) -> List[Dict[str, str]]:
        query = query.strip()
        result = []
        for autocompleter in self._autocompleters:
            current_result = list(itertools.islice(autocompleter(query), 0, 1000))
            if current_result:
                result.extend(current_result)
        return result

    def get_best_completion(self, query: str) -> Optional[Dict[str, str]]:
        # TODO: self.autocomplete() only returns the first 10 for each autocompleter.  Look at more?
        suggestions = self.autocomplete(query)
        if not suggestions:
            return None
        query_tokens = query.strip().lower().split()
        return max(
            suggestions,
            key=lambda sugg: self._get_suggestion_quality(
                query_tokens, sugg["display"]
            ),
        )

    def _get_suggestion_quality(self, query_tokens: List[str], display: str) -> float:
        suggestion_tokens = display.lower().split()
        intersection_tokens = set(query_tokens).intersection(suggestion_tokens)
        return len(intersection_tokens) / len(suggestion_tokens)

    _process_string_non_word_regex = re.compile(
        r"(?ui)[^\w\.]"
    )  # Most of the time we want to include periods in words

    @classmethod
    def _process_string(cls, string: str) -> str:
        # Cleaning inspired by <https://github.com/seatgeek/fuzzywuzzy/blob/6353e2/fuzzywuzzy/utils.py#L69>
        return " " + cls._process_string_non_word_regex.sub(" ", string).lower().strip()

    def _preprocess_phenos(self) -> None:
        for phenocode, pheno in self._phenos.items():
            pheno["--spaced--phenocode"] = self._process_string(phenocode)
            if "phenostring" in pheno:
                pheno["--spaced--phenostring"] = self._process_string(
                    pheno["phenostring"]
                )

    def _autocomplete_variant(self, query: str) -> Iterator[Dict[str, str]]:
        # chrom-pos-ref-alt format
        query = query.replace(",", "")
        chrom, pos, ref, alt = parse_variant(query, default_chrom_pos=False)
        if chrom is not None:
            key = "-".join(str(e) for e in [chrom, pos, ref, alt] if e is not None)

            # In Python's sort, chr1:23-A-T comes before chr1:23-A-TG, so this should always put exact matches first.
            cpra_rsid_pairs = list(
                self._cpras_rsids_sqlite3.execute(
                    "SELECT cpra,rsid FROM cpras_rsids WHERE cpra LIKE ? ORDER BY ROWID LIMIT 100",  # Input was sorted by cpra, so ROWID will sort by cpra
                    (key + "%",),
                )
            )
            if cpra_rsid_pairs:
                for cpra, rows in itertools.groupby(
                    cpra_rsid_pairs, key=lambda row: row["cpra"]
                ):
                    rowlist = list(rows)
                    cpra_display = cpra.replace("-", ":", 1)
                    if len(rowlist) == 1 and rowlist[0]["rsid"] is None:
                        display = cpra_display
                    else:
                        display = "{} ({})".format(
                            cpra_display, ",".join(row["rsid"] for row in rowlist)
                        )
                    yield {
                        "value": cpra_display,
                        "display": display,
                        "url": url_for(".variant_page", query=cpra_display),
                    }

    def _autocomplete_rsid(self, query: str) -> Iterator[Dict[str, str]]:
        key = query.lower()
        if query.startswith("rs"):
            ## <https://sqlite.org/np1queryprob.html> recommends doing lots of small queries, and it's fast:
            for suffix_length in [0, 1, 2]:
                for suffix in (
                    "".join(digits)
                    for digits in itertools.product("0123456789", repeat=suffix_length)
                ):
                    rows = list(
                        self._cpras_rsids_sqlite3.execute(
                            "SELECT cpra,rsid FROM cpras_rsids WHERE rsid=?",
                            (key + suffix,),
                        )
                    )
                    for row in rows:
                        rsid, cpra = row["rsid"], row["cpra"]
                        cpra_display = cpra.replace("-", ":", 1)
                        yield {
                            "value": cpra_display,
                            "display": "{} ({})".format(rsid, cpra_display),
                            "url": url_for(".variant_page", query=cpra_display),
                        }

    def _autocomplete_phenocode(self, query: str) -> Iterator[Dict[str, str]]:
        query = self._process_string(query)
        for phenocode, pheno in self._phenos.items():
            if query in pheno["--spaced--phenocode"]:
                yield {
                    "value": phenocode,
                    "display": (
                        "{} ({})".format(phenocode, pheno["phenostring"])
                        if "phenostring" in pheno
                        else phenocode
                    ),  # TODO: truncate phenostring intelligently
                    "url": url_for(".pheno_page", phenocode=phenocode),
                }

    def _autocomplete_phenostring(self, query: str) -> Iterator[Dict[str, str]]:
        query = self._process_string(query)
        for phenocode, pheno in self._phenos.items():
            if query in pheno["--spaced--phenostring"]:
                yield {
                    "value": phenocode,
                    "display": "{} ({})".format(pheno["phenostring"], phenocode),
                    "url": url_for(".pheno_page", phenocode=phenocode),
                }

    def _autocomplete_gene(self, query: str) -> Iterator[Dict[str, str]]:
        key = query.upper()
        if len(key) >= 2:

            alias_canonicals_pairs = list(
                self._gene_aliases_sqlite3.execute(
                    "SELECT alias,canonicals_comma FROM gene_aliases WHERE alias LIKE ? ORDER BY LENGTH(alias),alias LIMIT 10",
                    (key + "%",),
                )
            )
            for row in alias_canonicals_pairs:
                alias, canonical_symbols = row["alias"], row["canonicals_comma"].split(
                    ","
                )
                if len(canonical_symbols) > 1:
                    yield {
                        "value": canonical_symbols[0],
                        "display": "{} (alias for {})".format(
                            alias, " and ".join(canonical_symbols)
                        ),
                        "url": url_for(".gene_page", genename=canonical_symbols[0]),
                    }
                elif canonical_symbols[0] == alias:
                    yield {
                        "value": canonical_symbols[0],
                        "display": canonical_symbols[0],
                        "url": url_for(".gene_page", genename=canonical_symbols[0]),
                    }
                else:
                    yield {
                        "value": canonical_symbols[0],
                        "display": "{} (alias for {})".format(
                            alias, canonical_symbols[0]
                        ),
                        "url": url_for(".gene_page", genename=canonical_symbols[0]),
                    }
