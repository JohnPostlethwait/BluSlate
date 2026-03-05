import type { UIAdapter } from '@bluslate/core';
import { startSpinner, updateSpinner, succeedSpinner, failSpinner, stopSpinner } from './progress.js';
import { confirmRenames, confirmShowIdentification, confirmDvdCompareSelection } from './prompts.js';
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
      confirmDvdCompareSelection,
    },
    display: {
      displayResults,
      displaySummary,
    },
  };
}
