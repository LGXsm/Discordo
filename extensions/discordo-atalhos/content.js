chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'discordo-shortcut') return;
  if (message.command !== 'microphone' && message.command !== 'audio') return;
  const event = new Event(`discordo:global-shortcut:${message.command}`, { cancelable: true });
  respond({ handled: !document.dispatchEvent(event) });
});
