import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc

argv = [
    "--pid", "25492",
    "--player-name", "Nobutdopai",
    "--names", "scratch_names.txt",
    "--max-mib", "4096"
]

sc.main(argv)
