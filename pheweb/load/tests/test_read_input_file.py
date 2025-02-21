import pytest
import os
import shutil
import tempfile

from pheweb.load.read_input_file import PhenoReader


@pytest.fixture
def temp_data_dir():
    """
    Creates a unique temporary directory for each test.
    Cleans up afterward to avoid polluting your real workspace.
    """
    path = tempfile.mkdtemp(prefix="test-pheno-reader-")
    yield path
    shutil.rmtree(path, ignore_errors=True)


def write_assoc_file(filepath: str, content: str):
    """
    Convenience function to write lines (TSV header + rows) to an association file.
    """
    with open(filepath, "w") as f:
        f.write(content)


def test_pheno_reader_performance(temp_data_dir, benchmark):
    """
    Example performance test for reading ~10k variants.
    Run with 'pytest --benchmark-only' to see timing details.
    """
    assoc_path = os.path.join(temp_data_dir, "assoc_perf.tsv")

    lines = ["chrom\tpos\tref\talt\tpval"]
    for i in range(1, 100_001):
        pval = i * 1e-8
        lines.append(f"1\t{i}\tA\tC\t{pval}")

    content = "\n".join(lines) + "\n"
    write_assoc_file(assoc_path, content)

    pheno = {
        "phenocode": "test-perf",
        "assoc_files": [assoc_path],
    }

    def create_and_read():
        reader = PhenoReader(pheno)
        return sum(1 for _ in reader.get_variants())

    count = benchmark(create_and_read)
    assert count == 100_000, f"Expected 100k variants, got {count}"
