/**
 * electron-builder afterPack hook:
 * 1. Copies the platform-specific ffprobe binary into the app's resources/bin/
 *    directory so it's available at runtime outside the asar archive.
 * 2. Strips macOS extended attributes (resource forks, Finder info, quarantine
 *    flags) from the .app bundle before codesign runs.
 *
 * Must be .cjs (CommonJS) because electron-builder loads hooks via require().
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  // ── Copy ffprobe binary into app resources ────────────────────────────
  try {
    const ffprobePkg = require('@ffprobe-installer/ffprobe');
    const ffprobeSource = ffprobePkg.path;

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const ffprobeName = isWin ? 'ffprobe.exe' : 'ffprobe';

    // Resolve the resources directory inside the packaged app
    const resourcesDir = isMac
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');

    const binDir = path.join(resourcesDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const ffprobeDest = path.join(binDir, ffprobeName);
    console.log(`  • Copying ffprobe binary to: ${ffprobeDest}`);
    fs.copyFileSync(ffprobeSource, ffprobeDest);

    // Ensure the binary is executable (non-Windows)
    if (!isWin) {
      fs.chmodSync(ffprobeDest, 0o755);
    }
  } catch (err) {
    console.warn(`  • Warning: Could not bundle ffprobe: ${err.message}`);
  }

  // ── Strip macOS extended attributes ───────────────────────────────────
  if (process.platform !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`  • Stripping extended attributes from: ${appPath}`);
  // -c removes all standard xattrs; com.apple.provenance requires explicit deletion
  execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
  // Remove com.apple.provenance recursively (macOS 15+ sets this on downloaded files
  // and xattr -c does not clear it). Ignore errors for files that don't have it.
  execSync(`find "${appPath}" -exec xattr -d com.apple.provenance {} + 2>/dev/null || true`, { stdio: 'inherit' });
};
