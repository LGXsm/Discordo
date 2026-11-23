export function confirmSettingsExit(): Promise<'save' | 'discard' | 'stay'> {
  const prompt = document.createElement('dialog');
  prompt.className = 'settings-dialog settings-confirm';
  prompt.setAttribute('aria-labelledby', 'settings-confirm-title');
  prompt.innerHTML = `
    <form method="dialog">
      <h2 id="settings-confirm-title">Salvar alterações?</h2>
      <p>Você tem alterações pendentes.</p>
      <div class="settings-footer">
        <button type="submit" class="settings-button" value="stay" autofocus>Continuar editando</button>
        <button type="submit" class="settings-button" value="discard">Descartar</button>
        <button type="submit" class="primary-button" value="save">Salvar</button>
      </div>
    </form>`;
  document.body.append(prompt);
  prompt.showModal();
  return new Promise(resolve => prompt.addEventListener('close', () => {
    const choice = prompt.returnValue;
    prompt.remove();
    resolve(choice === 'save' || choice === 'discard' ? choice : 'stay');
  }, { once: true }));
}
