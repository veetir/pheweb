import os, sys

# Add the pheweb package into the PYTHONPATH so that we can import it.
# This assumes that you cloned pheweb from github.  If you installed with pip, maybe this has no effect?
sys.path.insert(0, "/home/veetir/Documents/pheweb")

# Activate a virtual environment to get pheweb's dependencies.
path = os.path.join("/home/veetir/Documents/pheweb/venv/bin/activate_this.py")
with open(path) as f:
    code = compile(f.read(), path, "exec")
    exec(code, dict(__file__=path))

# `data_dir` is the directory that contains `config.py` and `generated-by-pheweb/`.
data_dir = os.path.dirname(os.path.abspath(__file__))
os.environ["PHEWEB_DATADIR"] = data_dir

# Load `config.py`.
config_filepath = os.path.join(data_dir, "config.py")
assert os.path.exists(config_filepath)
import pheweb.conf

pheweb.conf.load_overrides_from_file(config_filepath)

# WSGI uses the variable named `application`.
from pheweb.serve.server import app as application
