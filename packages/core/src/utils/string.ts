export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}
