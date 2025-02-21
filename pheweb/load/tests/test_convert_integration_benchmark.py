import pytest
from pheweb.load.parse_input_files import convert
from pheweb import conf


@pytest.fixture
def temp_data_dir(tmp_path):
    """
    Pytest fixture that yields a Path object to a temporary directory.
    Everything inside is cleaned up after the test.
    """
    return tmp_path


def test_convert_integration_benchmark(temp_data_dir, monkeypatch, benchmark):
    """
    End-to-end benchmark for `convert()`.
    - Writes a 100k-line input association file in a temp directory.
    - Patches `conf.get_data_dir()` so the output files (e.g. "parsed/...")
      also go into our temp dir.
    - Calls convert() and measures real disk parse + write time.
    """

    monkeypatch.setattr(conf, "get_data_dir", lambda: str(temp_data_dir))

    input_file = temp_data_dir / "assoc_100k.tsv"
    lines = ["chrom\tpos\tref\talt\tpval\tmaf"]
    for i in range(1, 100_001):
        pval = i * 1e-8
        maf = 0.01 * 1e-8
        lines.append(f"1\t{i}\tA\tC\t{pval}\t{maf}")

    with open(input_file, "w") as f:
        f.write("\n".join(lines) + "\n")

    pheno = {
        "phenocode": "test-integration-100k",
        "assoc_files": [str(input_file)],
    }

    def run_convert():
        return list(convert(pheno))

    # benchmark
    results = benchmark(run_convert)

    assert len(results) == 1, f"Expected 1 result dict, got {results}"
    assert results[0].get("succeeded") is True, "convert() did not succeed"
    parsed_file = (
        temp_data_dir / "generated-by-pheweb" / "parsed" / "test-integration-100k"
    )
    assert parsed_file.exists(), f"Parsed file not found at {parsed_file}"
