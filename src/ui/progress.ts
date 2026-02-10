import ora, { type Ora } from 'ora';

let spinner: Ora | null = null;

export function startSpinner(text: string): void {
  // Stop any existing spinner before starting a new one
  if (spinner) {
    spinner.stop();
  }
  spinner = ora(text).start();
}

export function updateSpinner(text: string): void {
  if (spinner) spinner.text = text;
}

export function succeedSpinner(text?: string): void {
  if (spinner) {
    spinner.succeed(text);
    spinner = null;
  }
}

export function failSpinner(text?: string): void {
  if (spinner) {
    spinner.fail(text);
    spinner = null;
  }
}

export function stopSpinner(): void {
  if (spinner) {
    spinner.stop();
    spinner = null;
  }
}

export function progressText(current: number, total: number, fileName: string): string {
  return `[${current}/${total}] Processing: ${fileName}`;
}
