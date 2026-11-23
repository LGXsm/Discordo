const siteControls = 'Abra os controles do site na barra de endereço, permita o Microfone e tente novamente.';

export function microphoneRestriction() {
  if (!window.isSecureContext) return 'Abra o Discordo por HTTPS ou localhost para permitir o microfone.';
  const page = document as Document & {
    featurePolicy?: { allowsFeature(name: string): boolean };
    permissionsPolicy?: { allowsFeature(name: string): boolean };
  };
  if ((page.permissionsPolicy ?? page.featurePolicy)?.allowsFeature?.('microphone') === false) {
    return window.self !== window.top
      ? 'O microfone está bloqueado nesta visualização. Abra o mesmo endereço em uma aba do navegador.'
      : 'O microfone está bloqueado pela política desta página. Abra o Discordo no endereço principal.';
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'Esta visualização não oferece acesso ao microfone. Abra o Discordo em uma aba do navegador.';
  return '';
}

export async function microphonePermission() {
  try {
    return (await navigator.permissions?.query({ name: 'microphone' as PermissionName }))?.state;
  } catch {
    return undefined;
  }
}

export function microphoneError(error: unknown) {
  const restricted = microphoneRestriction();
  if (restricted) return restricted;
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return `O navegador não liberou o microfone. ${siteControls}`;
  }
  if (error instanceof DOMException && error.name === 'NotReadableError') {
    return 'O navegador encontrou o microfone, mas não conseguiu usá-lo. Confira se o dispositivo está disponível no sistema.';
  }
  return 'Microfone indisponível. Confira se o dispositivo está conectado.';
}

export const pendingMicrophone = 'O navegador ainda não respondeu. Confira a barra de endereço. Se estiver na prévia integrada, abra o Discordo em uma aba do Chrome ou Edge.';
