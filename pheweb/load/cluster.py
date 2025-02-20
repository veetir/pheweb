from ..utils import get_phenolist
from .. import conf
from ..file_utils import get_tmp_path, get_dated_tmp_path, get_pheno_filepath
from .load_utils import PerPhenoParallelizer
from boltons.fileutils import mkdir_p  # to make tmp directory

import sys, argparse
from boltons.iterutils import chunked
from typing import List, Dict, Any

header_template = {
    "slurm": """\
#!/bin/bash
#SBATCH --array=0-{n_jobs_m1}
#SBATCH --mem=4G
#SBATCH --time=5-0:0
#SBATCH --output={tmp_path}/slurm-%j.out
#SBATCH --error={tmp_path}/slurm-%j.out
""",
    "sge": """\
#!/bin/bash
#$ -t 0-{n_jobs_m1}
#$ -l h_vmem=4G
#$ -l h_rt=120:00:00
#$ -o {tmp_path}
#$ -e {tmp_path}
""",
    "uge": """\
#!/bin/bash
#$ -t 1-{n_jobs}
#$ -l h_vmem=4G
#$ -l h_rt=120:00:00
#$ -o {tmp_path}
#$ -e {tmp_path}
""",
}
array_id_variable = {
    "slurm": "SLURM_ARRAY_TASK_ID",
    "sge": "SGE_TASK_ID",
    "uge": "(($SGE_TASK_ID - 1))",
}
submit_command = {
    "slurm": "sbatch",
    "sge": "qsub",
    "uge": "qsub",
}
monitor_command = {
    "slurm": "squeue --long --array --job",
    "sge": "qstat -j",
    "uge": "qstat -j",
}


def run(argv: List[str]) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["slurm", "sge", "uge"], required=True)
    parser.add_argument(
        "--step", choices=["parse", "augment-phenos", "manhattan", "qq"], required=True
    )
    parser.add_argument("--N_per_job", default=5)
    args = parser.parse_args(argv)

    def should_process(pheno: Dict[str, Any]) -> bool:
        if args.step == "parse":
            from . import parse_input_files

            get_input_filepaths = parse_input_files.get_input_filepaths
            get_output_filepaths = parse_input_files.get_output_filepaths
        elif args.step == "augment-phenos":
            from . import augment_phenos

            get_input_filepaths = augment_phenos.get_input_filepaths
            get_output_filepaths = augment_phenos.get_output_filepaths
        elif args.step == "manhattan":
            from . import manhattan

            get_input_filepaths = manhattan.get_input_filepaths
            get_output_filepaths = manhattan.get_output_filepaths
        elif args.step == "qq":
            from . import qq

            get_input_filepaths = qq.get_input_filepaths
            get_output_filepaths = qq.get_output_filepaths
        else:
            raise Exception("No implementation for step {}".format(args.step))
        return PerPhenoParallelizer().should_process_pheno(
            pheno,
            get_input_filepaths=get_input_filepaths,
            get_output_filepaths=get_output_filepaths,
        )

    idxs = [i for i, pheno in enumerate(get_phenolist()) if should_process(pheno)]
    if not idxs:
        print("All phenos are up-to-date!")
        exit(0)

    jobs = chunked(idxs, args.N_per_job)
    batch_filepath = get_dated_tmp_path("{}-{}".format(args.engine, args.step)) + ".sh"
    tmp_path = get_tmp_path(args.step)
    mkdir_p(tmp_path)
    with open(batch_filepath, "w") as f:
        f.write(
            header_template[args.engine].format(
                n_jobs_m1=len(jobs) - 1, n_jobs=len(jobs), tmp_path=tmp_path
            )
        )
        f.write("\n\njobs=(\n")
        for job in jobs:
            f.write(",".join(map(str, job)) + "\n")
        f.write(")\n\n")
        f.write("export PHEWEB_DATADIR={!r}\n".format(conf.get_data_dir()))
        f.write(
            sys.argv[0]
            + " conf num_procs=1 "
            + args.step
            + " --phenos=${jobs[$"
            + array_id_variable[args.engine]
            + "]}\n"
        )
    print("Run:\n{} {}\n".format(submit_command[args.engine], batch_filepath))
    print("Monitor with `{} <jobid>`\n".format(monitor_command[args.engine]))
    print("output will be in {}".format(tmp_path))
