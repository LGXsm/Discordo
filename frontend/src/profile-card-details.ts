import { icon } from './icons';

export type ProfileCardDetails = { roles: string[]; editProfile: boolean; editRoles: boolean; switchAccount?: boolean };

export const profileCardDetailsMarkup = `
  <div class="profile-roles">
    <div data-card-roles></div>
    <button class="icon-button profile-add-role" type="button" data-edit-member-roles aria-label="Editar cargos" data-tooltip-label="Adicionar cargo" hidden>${icon('plus')}</button>
  </div>
  <button class="settings-button" type="button" data-edit-profile>${icon('profile')} Editar perfil</button>
  <button class="settings-button" type="button" data-card-switch-account hidden>${icon('swap')} Trocar de conta</button>`;

export function renderProfileCardDetails(card: HTMLElement, { roles, editProfile, editRoles, switchAccount }: ProfileCardDetails) {
  const labels = roles.length ? roles : ['Sem cargos neste servidor'];
  card.querySelector('[data-card-roles]')!.replaceChildren(...labels.map(label => {
    const element = document.createElement(roles.length ? 'span' : 'small');
    element.textContent = label;
    return element;
  }));
  card.querySelector<HTMLButtonElement>('[data-edit-profile]')!.hidden = !editProfile;
  card.querySelector<HTMLButtonElement>('[data-card-switch-account]')!.hidden = !switchAccount;
  card.querySelector<HTMLButtonElement>('[data-edit-member-roles]')!.hidden = !editRoles;
}
