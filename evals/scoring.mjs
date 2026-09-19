// A taxonomy omission counts once across the entire benchmark, not once per case.
export function scoreReport(report) {
  const completeCorrect = report.cases.filter((item) => item.completeCorrect).length;
  const numericChecksPass = report.cases.every((item) => item.numericChecksPass);
  const noMaterialFabrication = report.cases.every((item) => item.noMaterialFabrication);
  const correctedOmissionIds = [...new Set(report.cases.flatMap((item) => item.correctedOmissions))].sort();
  const omissionsCorrected = correctedOmissionIds.length;
  return {
    completeCorrect,
    numericChecksPass,
    noMaterialFabrication,
    omissionsCorrected,
    correctedOmissionIds,
    scoringMethod: report.scoringMethod,
    passed: completeCorrect >= 10 && numericChecksPass && noMaterialFabrication && omissionsCorrected >= 3,
  };
}
