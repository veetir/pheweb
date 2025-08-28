#!/usr/bin/env bash
# Build a static PheWeb site using the mock dataset.
# The resulting site can be served with GitHub Pages.
set -euo pipefail

OUTDIR=${1:-demo-site}
PHEWEB=${PHEWEB:-pheweb}

# Generate mock data
DATA_DIR=$(mktemp -d)
python "$(dirname "$0")/create_mock_data.py" "$DATA_DIR"
CACHE_DIR="$DATA_DIR/cache"
mkdir -p "$CACHE_DIR"

# Prepare phenolist and process data
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" phenolist glob --simple-phenocode "$DATA_DIR/assoc-files/*"
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" phenolist unique-phenocode
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" phenolist read-info-from-association-files
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" phenolist import-phenolist -f "$DATA_DIR/pheno-list-categories.json" "$DATA_DIR/categories.csv"
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" phenolist merge-in-info "$DATA_DIR/pheno-list-categories.json"
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" phenolist verify --required-columns=category
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" process
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" top-loci
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" best-of-pheno

# Start server in background
$PHEWEB conf data_dir="$DATA_DIR" cache="$CACHE_DIR" serve &
SERVER_PID=$!
# Wait for server to start
sleep 5

# Mirror the site
rm -rf "$OUTDIR"
wget --recursive --no-clobber --page-requisites --html-extension --convert-links \
     --no-parent --domains localhost:5000 --directory-prefix="$OUTDIR" \
     http://localhost:5000/ \
     http://localhost:5000/top_hits \
     http://localhost:5000/pheno/demo \
     http://localhost:5000/variant/1:869334-G-A

# Shutdown server
kill $SERVER_PID

SITE_DIR="$OUTDIR/localhost:5000"
echo "Static site generated in $SITE_DIR"
