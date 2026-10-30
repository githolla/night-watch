const publicHelpLines = new Set(["18002221222", "18002738255", "18006624357", "18007997233"]);
export function excludedCompanyPhone(number: string) {
  const digits = number.split(/\s*(?:ext\.?|x)\s*/i)[0].replace(/\D/g, "");
  return publicHelpLines.has(digits.length === 10 ? `1${digits}` : digits);
}
