const path = require('node:path');

const icon = path.join(__dirname, 'discordo.ico');

module.exports = {
  packagerConfig: {
    asar: true,
    icon,
    executableName: 'Discordo',
  },
  makers: [{
    name: '@electron-forge/maker-squirrel',
    config: { name: 'Discordo', exe: 'Discordo.exe', setupExe: 'Discordo-Setup.exe', setupIcon: icon },
  }],
};
