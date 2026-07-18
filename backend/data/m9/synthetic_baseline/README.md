# M9 synthetic baseline dataset

This directory contains a trainable 1,000-row synthetic baseline for the M9
two-head model. It is suitable for verifying the full training and gateway
flow, creating a baseline demo model, and comparing later reviewed datasets.

It is not expert-reviewed or drawn from real enterprise material. Do not use
its metrics as a claim of real-world confidentiality detection accuracy.

Run it with:

```powershell
python -m ml.m9_train --data-dir data/m9/synthetic_baseline --epochs 3
```

The composition is 110 records for each finance/hr/legal/engineering +
confidentiality combination, and 120 `other + non_confidential` records.
