# Disease Pattern Similarity — how to run the test scripts

> **Not a diagnostic tool.** These scripts report which known cardiac reference
> pattern (NOR / HCM / DCM) a set of measurements most *resembles*, with
> reasoning. They do not diagnose.

All commands run from the server folder:
`cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server`

**Requirement:** `python3` with numpy on your PATH (the Node service uses `python3`;
plain `python` on this machine has no numpy). The scripts auto-try `python3`, `py`,
then `python`.

---

## 1. Run the sanity checks (pass/fail)

Confirms archetypal NOR / HCM / DCM inputs rank correctly, edge cases handled.

```bash
node scripts/check_disease_similarity.js
```

Expected: `9 passed, 0 failed`, exit code 0. Use this after any change to the
reference values or method to prove nothing broke.

---

## 2. Try your own numbers (readable output)

Three ways to feed measurements:

**Named flags** (any subset — missing metrics are fine):
```bash
node scripts/try_disease_similarity.js --EF 64 --EDV 144 --ESV 51.84 --StrokeVolume 92.16
node scripts/try_disease_similarity.js --EF 35 --EDV 225 --ESV 145 --PeakGRS 18 --PeakGCS -15
```

**Inline JSON:**
```bash
node scripts/try_disease_similarity.js --json "{\"EF\":64,\"EDV\":144,\"ESV\":51.84}"
```

**Pipe a metrics object on stdin** — accepts a bare measurements object OR a full
`heartMetrics` output (it reads the `.measurements` field automatically), so you
can pipe Jiayi's metrics output straight in:
```bash
cat my_metrics.json | node scripts/try_disease_similarity.js
```

---

## 3. Call the Python core directly (raw JSON)

The underlying script reads JSON on stdin, writes JSON on stdout — same contract
as the heart-metrics script. Useful for scripting or checking the exact stored shape:

```bash
echo '{"measurements":{"EF":64,"EDV":144,"ESV":51.84,"StrokeVolume":92.16}}' | python3 src/python/compute_disease_similarity.py
```

---

## Feature keys

`EF`, `EDV`, `ESV`, `StrokeVolume`, `PeakGRS`, `PeakGCS` — any subset. The first
four come from the heart-metrics module (`heartMetrics.measurements`); the two
strain peaks come from the strain pipeline (supplied via the API request body,
since strain peaks are not yet persisted on the mask document).

See `../docs/DISEASE_SIMILARITY_REFERENCES.md` for the method and reference-value
citations.
