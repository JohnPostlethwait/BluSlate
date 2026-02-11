/**
 * electron-builder afterPack hook — strips macOS extended attributes (resource
 * forks, Finder info, quarantine flags) from the .app bundle before codesign
 * runs. Without this, ad-hoc signing fails with:
 *   "resource fork, Finder information, or similar detritus not allowed"
 *
 * Must be .cjs (CommonJS) because electron-builder loads hooks via require().
 */

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
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
