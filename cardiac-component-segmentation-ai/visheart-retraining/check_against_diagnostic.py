"""Compare an evaluate.py report with the orientation diagnostic's raw-arm Dice, case by case.

  python check_against_diagnostic.py REPORT.json [--label production] [--map mms1=mms]
         [--diagnostic E:\\Jy\\Unet\\diagnostics\\heldout_unet_orientation_full.json] [--tolerance 1e-9]

Exit code 0 only when at least one case was compared and every compared case matches within tolerance.
"""
import argparse
import json
import sys
from pathlib import Path

DEFAULT_DIAGNOSTIC = r"E:\Jy\Unet\diagnostics\heldout_unet_orientation_full.json"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("report")
    parser.add_argument("--label", default="production")
    parser.add_argument("--diagnostic", default=DEFAULT_DIAGNOSTIC)
    parser.add_argument("--map", action="append", default=[], metavar="REPORT_NAME=DIAGNOSTIC_NAME",
                        help="a report dataset name and its name in the diagnostic (default: the same name)")
    parser.add_argument("--tolerance", type=float, default=1e-9)
    args = parser.parse_args(argv)
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    diagnostic = json.loads(Path(args.diagnostic).read_text(encoding="utf-8"))
    names = dict(item.split("=", 1) for item in args.map)
    compared, worst, failures = 0, 0.0, []
    for dataset, cases in report["scores"][args.label].items():
        source = diagnostic["datasets"].get(names.get(dataset, dataset))
        if source is None:
            print(f"{dataset}: not in the diagnostic, skipped")
            continue
        reference = {case["case"]: case["dice"] for case in source["raw"]["cases"]}
        for case, scores in cases.items():
            if case not in reference:
                continue
            difference = max(abs(scores[name] - reference[case][name]) for name in reference[case])
            compared += 1
            worst = max(worst, difference)
            if difference > args.tolerance:
                failures.append(f"{dataset}/{case}: {difference:.2e}")
    print(f"compared {compared} cases; worst per-class difference {worst:.2e}")
    if failures:
        print("outside tolerance:\n" + "\n".join(failures))
    return 0 if compared and not failures else 1


if __name__ == "__main__":
    sys.exit(main())
