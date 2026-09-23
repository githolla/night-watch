/** Email house style: use normal punctuation, never long dashes. */
export function emailStyle(text: string): string {
  return text.replace(/[ \t]*(?:[\u2014\u2013]|&(?:mdash|ndash);|&#(?:8212|8211);|&#x(?:2014|2013);)[ \t]*/gi, ", ");
}

export function emailFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(part => !/^[A-Z]\.?$/i.test(part));
  return parts[0] || fullName.trim().split(/\s+/)[0] || "there";
}
