from ..load.load_utils import get_maf
from ..utils import (
    get_phenolist,
    get_gene_tuples,
    pad_gene,
    PheWebError,
    vep_consqeuence_category,
)
from .. import conf
from .. import parse_utils
from ..file_utils import get_filepath, get_pheno_filepath, VariantFileReader
from .server_utils import (
    get_variant,
    get_random_page,
    get_pheno_region,
    relative_redirect,
)
from .autocomplete import Autocompleter
from .auth import GoogleSignIn
from ..version import version as pheweb_version
from .. import weetabix

from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    abort,
    flash,
    send_from_directory,
    send_file,
    session,
    url_for,
    Blueprint,
)
from flask_compress import Compress
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user

import functools, math
import re
import traceback
import json
import os
import os.path
import sqlite3
from typing import Dict, Tuple, List, Any, Optional
import urllib.parse
import requests
import subprocess

bp = Blueprint("bp", __name__, template_folder="templates", static_folder="static")
app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), "static"))
Compress(app)
app.config["COMPRESS_LEVEL"] = 2  # Since we don't cache, faster=better
app.config["SECRET_KEY"] = conf.get_secret_key()
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 9
if conf.get_google_analytics_id():
    app.config["GOOGLE_ANALYTICS_TRACKING_ID"] = conf.get_google_analytics_id()
if conf.get_sentry_id() and not os.environ.get("PHEWEB_NO_SENTRY", ""):
    app.config["SENTRY_DSN"] = conf.get_sentry_id()
app.config["HG_BUILD_NUMBER"] = conf.get_hg_build_number()
app.config["GRCH_BUILD_NUMBER"] = conf.get_grch_build_number()
app.config["PHEWEB_VERSION"] = pheweb_version
app.config["LZJS_VERSION"] = conf.get_lzjs_version()
app.config["URLPREFIX"] = conf.get_urlprefix()
app.config["USE_WHITELIST"] = conf.is_login_required() and bool(
    conf.get_login_allowlist()
)
if conf.get_custom_templates_dir():
    jinja_searchpath = getattr(app.jinja_loader, "searchpath", None)
    if jinja_searchpath is None:
        raise Exception()
    jinja_searchpath.insert(0, conf.get_custom_templates_dir())

phenos = {pheno["phenocode"]: pheno for pheno in get_phenolist()}


def email_is_allowed(user_email: Optional[str] = None) -> bool:
    if user_email is None:
        user_email = current_user.email
        assert isinstance(user_email, str), user_email
    user_email = user_email.lower()
    if not conf.get_login_allowlist():  # anybody gets in!
        return True
    if user_email in conf.get_login_allowlist():  # their email is on the allowlist!
        return True
    allowed_domains = tuple(
        email for email in conf.get_login_allowlist() if email.startswith("@")
    )  # just domains, like @umich.edu
    if user_email.endswith(allowed_domains):  # their email is at an allowed domain!
        return True
    return False


def check_auth(func):
    """
    This decorator for routes checks that the user is authorized (or that no login is required).
    If they haven't, their intended destination is stored and they're sent to get authorized.
    It has to be placed AFTER @bp.route() so that it can capture `request.path`.
    """
    if not conf.is_login_required():
        return func

    # inspired by <https://flask-login.readthedocs.org/en/latest/_modules/flask_login.html#login_required>
    @functools.wraps(func)
    def decorated_view(*args, **kwargs):
        if current_user.is_anonymous:
            print("unauthorized user visited {!r}".format(request.path))
            session["original_destination"] = request.path
            return relative_redirect(url_for(".get_authorized"))
        print("{} visited {!r}".format(current_user.email, request.path))
        assert email_is_allowed()
        return func(*args, **kwargs)

    return decorated_view


autocompleter = Autocompleter(phenos)

def transform_column_to_rows(data_dict: dict) -> list:
    """
    Given a column-oriented dict such as:
      { "pval": [0.01, 0.02, ...],
        "pos": [110580113, 110580234, ...],
        ... }
    transform it into a list of row-oriented dictionaries.
    """
    if not data_dict:
        return []
    fields = list(data_dict.keys())
    # Use the length of the first array as the number of records.
    record_count = len(data_dict[fields[0]])
    rows = []
    for i in range(record_count):
        record = { field: data_dict[field][i] for field in fields }
        rows.append(record)
    return rows


@bp.route("/api/finngen-susie")
def api_finngen_susie():
    region = request.args.get("region")
    if not region:
        return (
            jsonify({"error": "Missing region parameter, expected format 'chr:start-end'"}),
            400,
        )

    endpoint_filter = request.args.get("endpoint")
    bed_path = os.path.join(
        conf.get_data_dir(), "endpoints-susie-merged.bed.gz"
    )

    try:
        result = subprocess.run(
            ["tabix", "-p", "bed", "-0", bed_path, region],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        return jsonify({"error": exc.stderr.strip() or str(exc)}), 500

    data = []
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) < 22:
            continue

        trait   = fields[3]
        cs      = fields[5]
        start   = int(fields[1])
        end     = int(fields[2])
        v_str   = fields[13]
        vpos    = int(v_str.split(":")[1])
        prob    = float(fields[18])
        good_cs = fields[11].lower() in ("1","true","t")
        gene    = fields[21]

        if endpoint_filter and trait != endpoint_filter:
            continue

        data.append({
            "trait": trait,
            "cs": cs,
            "start": start,
            "end": end,
            "vpos": vpos,
            "variant": v_str, 
            "prob": prob,
            "good_cs": good_cs,
            "gene_most_severe": gene
        })

    return jsonify({"data": data})


@bp.route("/api/gwascatalog")
def api_gwascatalog():
    region = request.args.get("region")
    if not region:
        return (
            jsonify({"error": "Missing region parameter, expected format 'chr:start-end'"}),
            400,
        )

    tsv_path = os.path.join(conf.get_data_dir(), "gwascat.tsv")

    try:
        result = subprocess.run(
            ["tabix", tsv_path, region],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        return jsonify({"error": exc.stderr.strip() or str(exc)}), 500

    data = []
    for line in result.stdout.splitlines():
        if line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) < 14:
            continue
        try:
            chrom = fields[0]
            pos = int(fields[1])
            logp = float(fields[5]) if fields[5] else None
            data.append(
                {
                    "chrom": chrom,
                    "pos": pos,
                    "log_pvalue": logp,
                    "study": fields[7],
                    "pmid": fields[8],
                    "trait": fields[6],
                    "risk_frq": fields[12],
                    "or_beta": fields[13],
                    "risk_allele": fields[11],
                    "rsid": fields[3],
                    "id": 7,
                }
            )
        except Exception:
            continue

    return jsonify({"data": data})

@functools.lru_cache()
def _load_atc_map() -> Dict[str, str]:
    """Return mapping of ATC codes to long names."""
    path = os.path.join(conf.get_data_dir(), "atc.txt")
    mapping: Dict[str, str] = {}
    if not os.path.exists(path):
        return mapping
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("Id"):
                continue
            parts = line.split("\t")
            if len(parts) >= 2:
                mapping[parts[0]] = parts[1]
    return mapping


@bp.route("/api/atc")
def api_atc_codes():
    """Serve mapping from ATC code to human-readable name."""
    return jsonify(_load_atc_map())

@bp.route("/api/finngen/<endpoint>")
@check_auth
def api_finngen(endpoint: str):
    """
    This endpoint accepts a query parameter "region" in the format "chr:start-end"
    
    The external API expects a URL-encoded filter string that describes the region.
    For example:
       analysis in 3 and chromosome in '20' and position ge 35187976 and position le 35687976
    """
    region = request.args.get("region")
    if not region:
        return jsonify({"error": "Missing region parameter, expected format 'chr:start-end'"}), 400

    try:
        # Parse region data, expected in the "chr:start-end" format
        parts = region.split(":")
        if len(parts) != 2:
            return jsonify({"error": "Invalid region format (expected 'chr:start-end')"}), 400
        chrom = parts[0]
        coords = parts[1].split("-")
        if len(coords) != 2:
            return jsonify({"error": "Invalid region coordinates (expected 'start-end')"}), 400
        pos_start, pos_end = coords[0], coords[1]
        
        # Construct the filter query string as required by FinnGen
        filter_query = (
            f"analysis in 3 and chromosome in '{chrom}' and position ge {pos_start} and position le {pos_end}"
        )
        # URL encode the filter parameter
        encoded_filter = urllib.parse.quote(filter_query)

        # Build the external API URL
        external_api_url = f"https://r12.finngen.fi/api/region/{endpoint}/lz-results/?filter={encoded_filter}"
        # Log or print the URL if desired
        print("Calling FinnGen external API:", external_api_url)
        
        # Fetch data from the external API.
        external_response = requests.get(external_api_url)
        external_response.raise_for_status()  # raise an error if the request failed
        
        external_json = external_response.json()
        
        # The external API returns a column-oriented structure under key "data"
        if "data" in external_json:
            transformed_data = transform_column_to_rows(external_json["data"])
        else:
            transformed_data = []
        
        return jsonify({"data": transformed_data})
    
    except Exception as e:
        # On error, return a JSON error message
        return jsonify({"error": str(e)}), 500

@bp.route("/api/autocomplete")
@check_auth
def autocomplete():
    query = request.args.get("query", "")
    suggestions = autocompleter.autocomplete(query)
    if suggestions:
        return jsonify(suggestions)
    return jsonify([])


@bp.route("/go")
@check_auth
def go():
    query = request.args.get("query", None)
    if query is None:
        die("How did you manage to get a null query?")
    best_suggestion = autocompleter.get_best_completion(query)
    if best_suggestion:
        return relative_redirect(best_suggestion["url"])
    die("Couldn't find page for {!r}".format(query))


@bp.route("/api/variant/<query>")
@check_auth
def api_variant(query: str):
    variant = get_variant(query)
    resp = jsonify(variant)
    if conf.should_allow_variant_json_cors():
        resp.headers.add("Access-Control-Allow-Origin", "*")
    return resp


@bp.route("/variant/<query>")
@check_auth
def variant_page(query: str):
    try:
        variant = get_variant(query)
        if variant is None:
            die("Sorry, I couldn't find the variant {}".format(query))
        return render_template(
            "variant.html",
            variant=variant,
            tooltip_lztemplate=parse_utils.tooltip_lztemplate,
        )
    except Exception as exc:
        die("Oh no, something went wrong", exc)


@bp.route("/api/manhattan/pheno/<phenocode>.json")
@check_auth
def api_pheno(phenocode: str):
    return send_from_directory(get_filepath("manhattan"), "{}.json".format(phenocode))


@bp.route("/api/manhattan-filtered/pheno/<phenocode>.json")
@check_auth
def api_pheno_filtered(phenocode):
    # Parse parameters from URL
    try:
        pheno = phenos[phenocode]
    except KeyError:
        abort(404, description="That phenocode wasn't found for this dataset.")
    indel = request.args.get("indel", "")
    if indel not in ["", "true", "false"]:
        abort(
            404,
            description="Invalid value for GET parameter `indel=`.  Valid values are ['', 'true', 'false'].",
        )
    consequence_category = request.args.get("csq", "")
    if consequence_category not in ["", "lof", "nonsyn"]:
        abort(
            404,
            description="Invalid value for GET parameter `csq=`.  Valid values are ['', 'lof', 'nonsyn'].",
        )
    min_maf, max_maf = None, None
    if request.args.get("min_maf"):
        try:
            min_maf = float(request.args["min_maf"])
        except Exception:
            abort(404, description="Failed to parse GET parameter `min_maf=`.")
    if request.args.get("max_maf"):
        try:
            max_maf = float(request.args["max_maf"])
        except Exception:
            abort(404, description="Failed to parse GET parameter `max_maf=`.")
    # Get variants according to filter
    chosen_variants = (
        []
    )  # TODO: stream straight from VariantFileReader() -> Binner() without this intermediate list
    weakest_pval_seen = 0
    num_variants = 0
    try:
        filepath = get_pheno_filepath("best_of_pheno", phenocode)
    except Exception:
        abort(
            404,
            description="Failed to find a best_of_pheno file.  Perhaps `pheweb best-of-pheno` wasn't run.",
        )
    with VariantFileReader(filepath) as vfr:
        for v in vfr:
            num_variants += 1
            if v["pval"] > weakest_pval_seen:
                weakest_pval_seen = v["pval"]
            if indel == "true" and len(v["ref"]) == 1 and len(v["alt"]) == 1:
                continue
            if indel == "false" and (len(v["ref"]) != 1 or len(v["alt"]) != 1):
                continue
            if min_maf is not None or max_maf is not None:
                v_maf = get_maf(v, pheno)
                if min_maf is not None and v_maf < min_maf:
                    continue
                if max_maf is not None and v_maf > max_maf:
                    continue
            if consequence_category:
                csq = vep_consqeuence_category.get(v.get("consequence", ""), "")
                if consequence_category == "lof" and csq != "lof":
                    continue
                if consequence_category == "nonsyn" and not csq:
                    continue
            chosen_variants.append(v)
    from pheweb.load.manhattan import Binner

    binner = Binner()
    for variant in chosen_variants:
        binner.process_variant(variant)
    manhattan_data = binner.get_result()
    manhattan_data["weakest_pval"] = weakest_pval_seen
    # print(f'indel={indel} maf={min_maf}-{max_maf} #chosen={len(chosen_variants)} #bins={len(manhattan_data["variant_bins"])} #unbinned={len(manhattan_data["unbinned_variants"])} weakest_pval={weakest_pval_seen}')
    return jsonify(manhattan_data)


@bp.route("/top_hits")
@check_auth
def top_hits_page():
    return render_template("top_hits.html")


@bp.route("/api/top_hits.json")
@check_auth
def api_top_hits():
    return send_file(get_filepath("top-hits-1k"))


@bp.route("/download/top_hits.tsv")
@check_auth
def download_top_hits():
    return send_file(get_filepath("top-hits-tsv"))


@bp.route("/phenotypes")
@check_auth
def phenotypes_page():
    return render_template("phenotypes.html")


@bp.route("/api/phenotypes.json")
@check_auth
def api_phenotypes():
    return send_file(get_filepath("phenotypes_summary"))


@bp.route("/download/phenotypes.tsv")
@check_auth
def download_phenotypes():
    return send_file(get_filepath("phenotypes_summary_tsv"))


@bp.route("/api/qq/pheno/<phenocode>.json")
@check_auth
def api_pheno_qq(phenocode: str):
    return send_from_directory(get_filepath("qq"), "{}.json".format(phenocode))


@bp.route("/random")
@check_auth
def random_page():
    url = get_random_page()
    if url is None:
        die(
            "Sorry, it looks like no hits in this pheweb reached the significance threshold."
        )
    return relative_redirect(url)


@bp.route("/pheno/<phenocode>")
@check_auth
def pheno_page(phenocode: str):
    try:
        pheno = phenos[phenocode]
    except KeyError:
        die("Sorry, I couldn't find the pheno code {!r}".format(phenocode))
    return render_template(
        "pheno.html",
        show_correlations=conf.should_show_correlations(),
        pheno_correlations_pvalue_threshold=conf.get_pheno_correlations_pvalue_threshold(),
        show_manhattan_filter_button=conf.should_show_manhattan_filter_button(),
        phenocode=phenocode,
        pheno=pheno,
        tooltip_underscoretemplate=parse_utils.tooltip_underscoretemplate,
    )


@bp.route("/pheno-filter/<phenocode>")
@check_auth
def pheno_filter_page(phenocode):
    try:
        pheno = phenos[phenocode]
    except KeyError:
        die("Sorry, I couldn't find the pheno code {!r}".format(phenocode))
    return render_template(
        "pheno-filter.html",
        phenocode=phenocode,
        pheno=pheno,
        tooltip_underscoretemplate=parse_utils.tooltip_underscoretemplate,
        show_manhattan_filter_consequence=conf.should_show_manhattan_filter_consequence(),
    )


@bp.route("/region/<phenocode>/<region>")
@check_auth
def region_page(phenocode: str, region: str):
    try:
        pheno = phenos[phenocode]
    except KeyError:
        die("Sorry, I couldn't find the phewas code {!r}".format(phenocode))
    pheno["phenocode"] = phenocode
    return render_template(
        "region.html",
        pheno=pheno,
        region=region,
        tooltip_lztemplate=parse_utils.tooltip_lztemplate,
    )


@bp.route("/api/region/<phenocode>/lz-results/")  # This API is easier on the LZ side.
@check_auth
def api_region(phenocode: str):
    filter_param = request.args.get("filter")
    if not isinstance(filter_param, str):
        abort(404)
    m = re.match(
        r".*chromosome in +'(.+?)' and position ge ([0-9]+) and position le ([0-9]+)",
        filter_param,
    )
    if not m:
        abort(404)
    else:
        chrom, pos_start, pos_end = m.group(1), int(m.group(2)), int(m.group(3))
        return jsonify(get_pheno_region(phenocode, chrom, pos_start, pos_end))


@bp.route("/api/pheno/<phenocode>/correlations/")
@check_auth
def api_pheno_correlations(phenocode: str):
    """Send information about phenotype correlations. This is an optional feature controlled by configuration."""
    if not conf.should_show_correlations():
        return (
            jsonify(
                {
                    "error": "This PheWeb instance does not support the requested endpoint."
                }
            ),
            400,
        )

    annotated_correl_fn = get_filepath("correlations")
    rows = weetabix.get_indexed_rows(annotated_correl_fn, phenocode, strict=False)
    # TODO: Decouple so that the route doesn't contain assumptions about file format
    # TODO: Check w/Daniel for "edge case" type assumptions- eg underflow on pvalues, weird field values?
    payload = []
    for row in rows:
        _, t2, rg, se, z, p, method, desc = row.split("\t")
        payload.append(
            {
                "trait": t2,
                "label": desc,
                "rg": float(rg),
                "SE": float(se),
                "Z": float(z),
                "pvalue": float(p),
                "method": method,
            }
        )
    return jsonify({"data": payload})


@functools.lru_cache(None)
def get_gene_region_mapping() -> Dict[str, Tuple[str, int, int]]:
    return {
        genename: (chrom, pos1, pos2)
        for chrom, pos1, pos2, genename in get_gene_tuples()
    }


@functools.lru_cache(None)
def get_best_phenos_by_gene_db():
    db = sqlite3.connect(get_filepath("best-phenos-by-gene-sqlite3"))
    db.row_factory = sqlite3.Row
    return db


def get_best_phenos_for_gene(gene: str) -> List[Dict[str, Any]]:
    db = get_best_phenos_by_gene_db()
    for row in db.execute(
        "SELECT json FROM best_phenos_for_each_gene WHERE gene = ?", (gene,)
    ):
        return json.loads(row["json"])
    return []


@bp.route("/region/<phenocode>/gene/<genename>")
@check_auth
def gene_phenocode_page(phenocode: str, genename: str):
    try:
        gene_region_mapping = get_gene_region_mapping()
        chrom, start, end = gene_region_mapping[genename]

        include_string = request.args.get("include", "")
        if include_string:
            include_chrom, include_pos = include_string.split("-")
            include_pos = int(include_pos)
            assert include_chrom == chrom
            if include_pos < start:
                start = int(include_pos - (end - start) * 0.01)
            elif include_pos > end:
                end = math.ceil(include_pos + (end - start) * 0.01)
        start, end = pad_gene(start, end)

        pheno = phenos[phenocode]

        phenos_in_gene = []
        for pheno_in_gene in get_best_phenos_for_gene(genename):
            phenos_in_gene.append(
                {
                    "pheno": {
                        k: v
                        for k, v in phenos[pheno_in_gene["phenocode"]].items()
                        if k not in ["assoc_files", "colnum"]
                    },
                    "assoc": {
                        k: v for k, v in pheno_in_gene.items() if k != "phenocode"
                    },
                }
            )

        return render_template(
            "gene.html",
            pheno=pheno,
            significant_phenos=phenos_in_gene,
            gene_symbol=genename,
            region="{}:{}-{}".format(chrom, start, end),
            tooltip_lztemplate=parse_utils.tooltip_lztemplate,
        )
    except Exception as exc:
        die(
            "Sorry, your region request for phenocode {!r} and gene {!r} didn't work".format(
                phenocode, genename
            ),
            exception=exc,
        )


@bp.route("/gene/<genename>")
@check_auth
def gene_page(genename: str):
    phenos_in_gene = get_best_phenos_for_gene(genename)
    if not phenos_in_gene:
        die(
            "Sorry, that gene doesn't appear to have any associations in any phenotype."
        )
    return gene_phenocode_page(phenos_in_gene[0]["phenocode"], genename)


if conf.should_show_download_top_hits_button():
    app.config["DOWNLOAD_TOP_HITS_BUTTON"] = True

if conf.should_show_download_phenotypes_button():
    app.config["DOWNLOAD_PHENOTYPES_BUTTON"] = True

if conf.is_secret_download_pheno_sumstats():
    if app.config["SECRET_KEY"] == "nonsecret key":
        raise PheWebError(
            'you must set a SECRET_KEY in config.py to use download_pheno_sumstats = "secret"'
        )

    class Hasher:
        _hash_length = 15

        @classmethod
        def get_hash(cls, plaintext: str) -> str:
            import hashlib

            return hashlib.blake2b(
                plaintext.encode("utf8"),
                digest_size=cls._hash_length,
                key=app.config["SECRET_KEY"].encode("utf8"),
            ).hexdigest()

        @classmethod
        def check_hash(cls, hash_: str, plaintext: str) -> bool:
            if len(hash_) != cls._hash_length * 2:
                return False
            import hmac

            return hmac.compare_digest(cls.get_hash(plaintext), hash_)

    @bp.route("/download/<phenocode>/<token>")
    def download_pheno(phenocode: str, token: str):
        if phenocode not in phenos:
            die("Sorry, that phenocode doesn't exist")
        if not Hasher.check_hash(token, phenocode):
            die("Sorry, that token is incorrect")
        try:
            return send_from_directory(
                get_filepath("pheno_gz"),
                "{}.gz".format(phenocode),
                as_attachment=True,
                attachment_filename="phenocode-{}.tsv.gz".format(phenocode),
            )
        except Exception as exc:
            die("Sorry, that file doesn't exist.", exception=exc)

    download_list_secret_token = Hasher.get_hash(
        "|".join(sorted(phenos.keys()))
    )  # Shouldn't change when we restart the server.
    print("download page:", "/download-list/{}".format(download_list_secret_token))

    @bp.route("/download-list/<token>")
    def download_list(token: str):
        if token != download_list_secret_token:
            print(
                url_for(
                    ".download_list",
                    token=Hasher.get_hash("download-list"),
                    _external=True,
                )
            )
            die("Wrong token.")
        ret = ""
        for phenocode, pheno in phenos.items():
            url = url_for(
                ".download_pheno",
                phenocode=phenocode,
                token=Hasher.get_hash(phenocode),
                _external=True,
            )
            ret += "{} {} <a href={url!r}>{url!r}</a><br>\n".format(
                phenocode, pheno.get("phenostring", ""), url=url
            )
        return ret, 200

else:
    app.config["DOWNLOAD_PHENO_SUMSTATS_BUTTON"] = True

    @bp.route("/download/<phenocode>")
    def download_pheno(phenocode: str):
        if phenocode not in phenos:
            die("Sorry, that phenocode doesn't exist")
        return send_from_directory(
            get_filepath("pheno_gz"),
            "{}.gz".format(phenocode),
            as_attachment=True,
            attachment_filename="phenocode-{}.tsv.gz".format(phenocode),
        )


@bp.route("/")
def homepage():
    return render_template("index.html")


@bp.route("/favicon.ico")
def favicon():
    return send_from_directory(app.static_folder, "favicon.ico")


@bp.route("/about")
def about_page():
    return render_template("about.html")


def die(message="no message", exception=None):
    if exception is not None:
        print("Exception:", exception)
        traceback.print_exc()
    print(message, flush=True)
    flash(message)
    abort(404)


@bp.errorhandler(404)
def error_page(message: str):
    return render_template("error.html", message=message), 404


# Resist some CSRF attacks
@bp.after_request
def apply_caching(response):
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


### OAUTH2
if conf.is_login_required():
    google_sign_in = GoogleSignIn(app)

    lm = LoginManager(app)
    lm.login_view = "homepage"

    class User(UserMixin):
        "A user's id is their email address."

        def __init__(self, username=None, email=None):
            self.username = username
            self.email = email

        def get_id(self):
            return self.email

        def __repr__(self):
            return "<User email={!r}>".format(self.email)

    @lm.user_loader
    def load_user(id):
        if not email_is_allowed(id):
            return None
        return User(email=id)

    @bp.route("/logout")
    @check_auth
    def logout():
        print(current_user.email, "logged out")
        logout_user()
        return relative_redirect(url_for(".homepage"))

    @bp.route("/login_with_google")
    def login_with_google():
        "this route is for the login button"
        session["original_destination"] = url_for(".homepage")
        return relative_redirect(url_for(".get_authorized"))

    @bp.route("/get_authorized")
    def get_authorized():
        "This route tries to be clever and handle lots of situations."
        if current_user.is_anonymous:
            return google_sign_in.authorize()
        else:
            if "original_destination" in session:
                orig_dest = session["original_destination"]
                del session[
                    "original_destination"
                ]  # We don't want old destinations hanging around.  If this leads to problems with re-opening windows, disable this line.
            else:
                orig_dest = url_for(".homepage")
            return relative_redirect(orig_dest)

    @bp.route("/callback/google")
    def oauth_callback_google():
        if not current_user.is_anonymous:
            return relative_redirect(url_for(".homepage"))
        try:
            username, email = (
                google_sign_in.callback()
            )  # oauth.callback reads request.args.
        except Exception as exc:
            print("Error in google_sign_in.callback():")
            print(exc)
            print(traceback.format_exc())
            flash(
                "Something is wrong with authentication.  Please email pjvh@umich.edu"
            )
            return relative_redirect(url_for(".homepage"))
        if email is None:
            # I need a valid email address for my user identification
            flash(
                "Authentication failed by failing to get an email address.  Please email pjvh@umich.edu"
            )
            return relative_redirect(url_for(".homepage"))

        if not email_is_allowed(email):
            flash(
                "Your email, {!r}, is not in the list of allowed emails.".format(email)
            )
            return relative_redirect(url_for(".homepage"))

        # Log in the user, by default remembering them for their next visit.
        user = User(username, email)
        login_user(user, remember=True)

        print(user.email, "logged in")
        return relative_redirect(url_for(".get_authorized"))


app.register_blueprint(bp, url_prefix=app.config["URLPREFIX"])
