import type { UIAdapter } from '@mediafetch/core';
import { startSpinner, updateSpinner, succeedSpinner, failSpinner, stopSpinner } from './progress.js';
import { confirmRenames } from './prompts.js';
import { confirmShowIdentification } from './prompts.js';
import { displayResults, displaySummary } from './display.js';

export function createCliAdapter(): UIAdapter {
  return {
    progress: {
      start: startSpinner,
      update: updateSpinner,
      succeed: succeedSpinner,
      fail: failSpinner,
      stop: stopSpinner,
    },
    prompts: {
      confirmRenames,
      confirmShowIdentification,
    },
    display: {
      displayResults,
      displaySummary,
    },
  };
}
