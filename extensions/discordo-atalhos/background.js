const discordoPages = ['https://discordo.lgmartinez.com/*', 'https://lgmartinez.com/discordo/*'];
const commands = new Set(['microphone', 'audio']);

chrome.commands.onCommand.addListener(async command => {
  if (!commands.has(command)) return;
  const tabs = await chrome.tabs.query({ url: discordoPages });
  tabs.sort((first, second) => Number(Boolean(second.active)) - Number(Boolean(first.active))
    || (second.lastAccessed ?? 0) - (first.lastAccessed ?? 0));
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'discordo-shortcut', command }, { frameId: 0 });
      if (reply?.handled) return;
    } catch {
      // A newly loaded tab may not have its content script yet.
    }
  }
});
