const { existsSync } = require('node:fs');
const path = require('node:path');

function refreshShortcutIcons(shell, executable, desktop, appData) {
  const versionDir = path.dirname(executable);
  const root = path.dirname(versionDir);
  if (!/^app-[\da-z.-]+$/i.test(path.basename(versionDir)) ||
      !existsSync(path.join(root, 'Update.exe'))) return;

  const name = path.basename(executable).toLowerCase();
  const normalized = value => path.normalize(value).toLowerCase();
  const ownsPath = value => {
    if (!value || path.basename(value).toLowerCase() !== name) return false;
    const directory = path.dirname(normalized(value));
    return directory === normalized(root) ||
      (path.dirname(directory) === normalized(root) && /^app-[\da-z.-]+$/i.test(path.basename(directory)));
  };
  const shortcuts = [
    path.join(desktop, 'Discordo.lnk'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'LGXsm', 'Discordo.lnk'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Discordo.lnk'),
  ];
  for (const shortcut of shortcuts) {
    if (!existsSync(shortcut)) continue;
    try {
      const details = shell.readShortcutLink(shortcut);
      if (!ownsPath(details.target) || (details.icon && !ownsPath(details.icon))) continue;
      if (details.icon && normalized(details.icon) === normalized(executable) && details.iconIndex === 0) continue;
      // A version-specific icon path prevents Explorer from reusing the cached image of the launcher.
      shell.writeShortcutLink(shortcut, 'update', { ...details, icon: executable, iconIndex: 0 });
    } catch (error) {
      console.warn('Não foi possível atualizar o ícone de um atalho do Discordo.', error.message);
    }
  }
}

module.exports = { refreshShortcutIcons };
