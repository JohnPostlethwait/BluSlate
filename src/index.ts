import { createProgram } from './cli.js';
import { stopSpinner } from './ui/progress.js';

// Handle Ctrl-C gracefully
process.on('SIGINT', () => {
  stopSpinner();
  console.log('\n\nCancelled by user.');

  // Remove this handler and re-raise SIGINT to let Node's default
  // behavior terminate the process (kills pending I/O immediately)
  process.removeAllListeners('SIGINT');
  process.kill(process.pid, 'SIGINT');
});

const program = createProgram();
program.parse();
