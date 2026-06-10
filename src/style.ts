// Zero-dependency ANSI styling. Disabled when piped or when NO_COLOR is set.
const enabled = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const wrap = (code: string) => (s: string): string => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = wrap('1');
export const dim = wrap('2');
export const cyan = wrap('36');
export const green = wrap('32');
export const yellow = wrap('33');
export const red = wrap('31');

export const header = (s: string): string => bold(cyan(s));
export const money = (s: string): string => bold(green(s));
export const warn = (s: string): string => yellow(s);
export const note = (s: string): string => dim(s);
