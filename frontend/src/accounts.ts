import { forgetTutorial } from './tutorial';
import type { ProfileAppearance } from './profile-appearance';
import type { AvatarCrop } from './avatar';

export type ProfileSoundKind = 'entrySound' | 'exitSound' | 'moveEntrySound' | 'moveExitSound' | 'punishedSound' | 'disconnectSound' | 'absenceSound';
export type ProfileSounds = Partial<Record<`${ProfileSoundKind}Url`, string | null>>;

export type Account = ProfileSounds & {
  name: string;
  avatarUrl?: string;
  avatarStillUrl?: string;
  avatarCrop?: AvatarCrop;
  bannerUrl?: string;
  appearance?: ProfileAppearance | null;
  email: string;
  birthDate: string;
};

export type Profile = Pick<Account, 'name' | 'avatarUrl' | 'avatarStillUrl' | 'avatarCrop' | 'bannerUrl'>;
type Media = Omit<Profile, 'name'>;
type ServerAccount = Omit<Account, keyof Media> & { [Key in keyof Media]?: Media[Key] | null };
export const accountStorageKey = 'discordo:session-changed';
const legacyAccountsKey = 'discordo:accounts:v1';
const endpoint = new URL(`${import.meta.env.BASE_URL}account.php`, document.baseURI);

const mediaKey = (email: string) => `discordo:profile-media:${email}`;

function localMedia(email: string): Media | undefined {
  try {
    const stored = localStorage.getItem(mediaKey(email));
    return stored
      ? JSON.parse(stored) as Media
      : (JSON.parse(localStorage.getItem(legacyAccountsKey) ?? '{}').accounts as Account[] | undefined)
        ?.find(candidate => candidate.email === email);
  } catch {
    return undefined;
  }
}

function accountView(account: ServerAccount): Account {
  return {
    ...account,
    avatarUrl: account.avatarUrl ?? undefined,
    avatarStillUrl: account.avatarStillUrl ?? undefined,
    avatarCrop: account.avatarCrop ?? undefined,
    bannerUrl: account.bannerUrl ?? undefined,
  };
}

async function pngStill(source?: string) {
  if (!source || source.startsWith('data:image/png;')) return source;
  const image = await createImageBitmap(await (await fetch(source)).blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 192, 192);
    return canvas.toDataURL('image/png');
  } finally {
    image.close();
  }
}

async function restoreMedia(account: ServerAccount): Promise<Account> {
  const cached = localMedia(account.email);
  const avatar = account.avatarUrl === undefined && cached?.avatarUrl?.startsWith('data:') ? cached.avatarUrl : undefined;
  const banner = account.bannerUrl === undefined && cached?.bannerUrl?.startsWith('data:') ? cached.bannerUrl : undefined;
  if (!avatar && !banner) return accountView(account);
  try {
    const avatarStill = avatar?.startsWith('data:image/gif;') ? await pngStill(cached?.avatarStillUrl) : undefined;
    const saved = await request({ action: 'profile', email: account.email, onlyMissing: true, avatar, avatarStill, banner });
    if (saved) return accountView(saved);
  } catch {
    // Retain the local image while a failed migration can still be retried.
  }
  return accountView({
    ...account,
    avatarUrl: avatar ?? account.avatarUrl,
    avatarStillUrl: avatar ? cached?.avatarStillUrl : account.avatarStillUrl,
    bannerUrl: banner ?? account.bannerUrl,
  });
}

function notifySessionChanged() {
  try {
    localStorage.setItem(accountStorageKey, crypto.randomUUID());
  } catch {
    // A sessão do servidor funciona mesmo quando o armazenamento local está bloqueado.
  }
}

type Verification = { token: string; resendAfter: number };

export async function accountRequest(data?: Record<string, unknown>) {
  const response = await fetch(endpoint, data && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'account' },
    body: JSON.stringify(data),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('O serviço de contas do Discordo está indisponível.');
  }
  const result: { account?: ServerAccount | null; verification?: Verification; deleted?: boolean; saved?: boolean; email?: string; phone?: string | null; sessions?: { id: number; current: boolean }[]; error?: string } = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível acessar a conta.');
  return result;
}

async function request(data?: Record<string, unknown>) {
  return (await accountRequest(data)).account ?? undefined;
}
export async function currentAccount() {
  const account = await request();
  return account ? restoreMedia(account) : undefined;
}

export async function deleteAccount(email: string, password: string) {
  const result = await accountRequest({ action: 'deleteAccount', email, password });
  if (result.deleted !== true) throw new Error('Não foi possível confirmar a exclusão da conta.');
  forgetTutorial(email);
  try {
    for (const key of [mediaKey(email), `discordo:voice:${email}`, `discordo:shortcuts:${email}`, `discordo:participant-audio:${email}`]) {
      localStorage.removeItem(key);
    }
    const raw = localStorage.getItem(legacyAccountsKey);
    if (raw) {
      const legacy = JSON.parse(raw);
      if (Array.isArray(legacy.accounts)) {
        legacy.accounts = legacy.accounts.filter((account: Account) => account.email !== email);
        if (legacy.accounts.length) localStorage.setItem(legacyAccountsKey, JSON.stringify(legacy));
        else localStorage.removeItem(legacyAccountsKey);
      }
    }
  } catch { /* A configuração do navegador pode impedir o acesso ao armazenamento local. */ }
  notifySessionChanged();
}

export async function signOut() {
  await request({ action: 'logout' });
  notifySessionChanged();
}

export async function updateProfile(previous: Account, profile: Profile): Promise<Account> {
  const avatar = profile.avatarUrl !== previous.avatarUrl || profile.avatarCrop !== previous.avatarCrop
    ? profile.avatarUrl ?? null : undefined;
  const banner = profile.bannerUrl !== previous.bannerUrl ? profile.bannerUrl ?? null : undefined;
  const avatarStill = avatar?.startsWith('data:image/gif;') ? await pngStill(profile.avatarStillUrl) : undefined;
  const name = profile.name !== previous.name ? profile.name : undefined;
  const avatarCrop = avatar?.startsWith('data:image/gif;') ? profile.avatarCrop : undefined;
  const account = await request({ action: 'profile', email: previous.email, name, avatar, avatarStill, avatarCrop, banner });
  if (!account) throw new Error('A sessão mudou. Abra as configurações novamente.');
  return accountView(account);
}

export async function updateProfileSound(email: string, kind: ProfileSoundKind, sound: string | null): Promise<ProfileSounds> {
  const account = await request({ action: 'profileSound', email, kind, sound });
  if (!account) throw new Error('A sessão mudou. Abra as configurações novamente.');
  return { entrySoundUrl: account.entrySoundUrl, exitSoundUrl: account.exitSoundUrl,
    moveEntrySoundUrl: account.moveEntrySoundUrl, moveExitSoundUrl: account.moveExitSoundUrl,
    punishedSoundUrl: account.punishedSoundUrl, disconnectSoundUrl: account.disconnectSoundUrl,
    absenceSoundUrl: account.absenceSoundUrl };
}

export async function updateProfileAppearance(email: string, appearance: ProfileAppearance) {
  const account = await request({ action: 'profileAppearance', email, ...appearance });
  if (!account?.appearance) throw new Error('Não foi possível confirmar a aparência salva.');
  return account.appearance;
}

export async function verifyAccountCode(token: string, code: string): Promise<Account> {
  const account = await request({ action: 'verifyCode', token, code });
  if (!account) throw new Error('Não foi possível abrir a sessão.');
  notifySessionChanged();
  return restoreMedia(account);
}

async function requestCode(data: Record<string, string>) {
  const { verification } = await accountRequest(data);
  if (!verification) throw new Error('Não foi possível solicitar o código.');
  return verification;
}

export async function signIn(email: string, password: string): Promise<{ account: Account } | { verification: Verification }> {
  const { account, verification } = await accountRequest({ action: 'login', email, password, acceptTrustedDevice: true });
  if (account) {
    notifySessionChanged();
    return { account: await restoreMedia(account) };
  }
  if (verification) return { verification };
  throw new Error('Não foi possível abrir a sessão.');
}

export function signUp(name: string, email: string, password: string, birthDate: string) {
  return requestCode({ action: 'register', name, email, password, birthDate });
}

export function resendAccountCode(token: string) {
  return requestCode({ action: 'resendCode', token });
}
