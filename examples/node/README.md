# Regression report

Compares traces from two versions of an agent, for example before and after a model upgrade, writes the figures as SVG, and exits with status 1 when a failure pattern becomes more common. Drop it into CI next to your evaluation run.

```bash
cd ../../js && npm install && npm run build
cd ../examples/node && npm install && npm run report
```

The checks are grammar queries in `report.ts`; edit them to match your harness.
