export function directoryDigits(name: string): string | null {
  const letters = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toUpperCase();
  if (!letters) return null;
  const keys = ["ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ"];
  return [...letters].map(letter => String(keys.findIndex(key => key.includes(letter)) + 2)).join("");
}
