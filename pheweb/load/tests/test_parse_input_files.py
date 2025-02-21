from unittest.mock import patch, MagicMock


def test_convert_handles_missing_pval():
    fake_variants = [
        {"chrom": "1", "pos": 100, "ref": "A", "alt": "T", "pval": ""},
        {"chrom": "1", "pos": 200, "ref": "G", "alt": "C", "pval": "0.02"},
    ]

    with patch("pheweb.load.parse_input_files.PhenoReader") as MockReader:
        mock_instance = MockReader.return_value
        mock_instance.get_variants.return_value = fake_variants

        with patch("pheweb.load.parse_input_files.VariantFileWriter", MagicMock()):
            from pheweb.load.parse_input_files import convert

            pheno = {"phenocode": "mock-pheno", "assoc_files": []}
            results = list(convert(pheno))

    # Should yield one final dict with "succeeded": True
    assert len(results) == 1
    assert results[0].get("succeeded") is True
