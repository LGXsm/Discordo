"""Build and upload only the Discordo public files over verified FTPS."""

import ftplib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import uuid


project = Path(__file__).resolve().parents[1]
config_path = project.parents[1] / "deploy" / "ftp_config.json"
target = "/public_html/discordo"
alias_target = "/lgmartinez.com/discordo"
domain = "discordo.lgmartinez.com"
config = json.loads(config_path.read_text(encoding="utf-8-sig"))
if config["domain"] != "lgmartinez.com" or config["host"] != "69.49.241.189":
    raise SystemExit("A configuração de hospedagem não corresponde ao destino do Discordo.")

build_env = {**os.environ, "VITE_DISCORDO_VOICE_TRANSPORT": "http"}
npm = "npm.cmd" if os.name == "nt" else "npm"
subprocess.run([npm, "run", "test:servers"], cwd=project, check=True)
subprocess.run([npm, "run", "build"], cwd=project, env=build_env, check=True)
dist = project / "dist"


def upload_bytes(ftp, source, remote):
    temporary = f"{remote}.{uuid.uuid4().hex}.upload"
    ftp.storbinary(f"STOR {temporary}", source)
    ftp.rename(temporary, remote)
    print(f"Enviado: {remote}")

def upload(ftp, local, remote):
    with local.open("rb") as source:
        upload_bytes(ftp, source, remote)


def list_files(ftp):
    return {item.rsplit("/", 1)[-1] for item in ftp.nlst()} - {".", ".."}


def upload_site(ftp, voice_file, account_file, servers_file, chat_file):
    existing = list_files(ftp)
    for folder in ("assets", "art"):
        if folder not in existing:
            ftp.mkd(folder)
    for asset in sorted((dist / "assets").iterdir()):
        upload(ftp, asset, f"assets/{asset.name}")
    for name in ("logo.webp", "logo-principal.webp", "logo-pequena.webp", "wall.webp", "chat-grafite.webp", "chat-parede-ultrawide.webp", "fundo-amizades.webp", "new-background.webp", "tijolos-chat.webp",
                 "voice-recua-fascista.webp", "voice-se-fudeu.webp"):
        upload(ftp, dist / "art" / name, f"art/{name}")
    upload(ftp, voice_file, "voice.php")
    upload(ftp, account_file, "account.php")
    upload(ftp, servers_file, "servers.php")
    upload(ftp, chat_file, "chat.php")
    upload(ftp, dist / "discordo-atalhos.zip", "discordo-atalhos.zip")
    upload(ftp, dist / "index.html", "index.html")


with ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=25) as ftp:
    ftp.connect(config["host"], int(config.get("port", 21)))
    # The endpoint presents HostGator's wildcard certificate, rather than the site's certificate.
    ftp.host = "hostgator.com.br"
    ftp.auth()
    ftp.login(config["user"], config["password"])
    ftp.prot_p()
    ftp.cwd(target)
    if ftp.pwd().rstrip("/") != target:
        raise RuntimeError("Pasta de publicação inesperada.")
    for name in ("channel-layout.php", "reserved-role-colors.php", "database.php", "account-verification.php", "account-settings.php", "account-deletion.php", "friends.php", "server-access.php", "server-invites.php", "profile-media.php", "profile-sounds.php", "profile-appearance.php",
                 "chat-media.php", "gameplay.php", "channel-voice-limit.php", "role-order.php", "voice-room-state.php"):
        upload(ftp, project / "backend" / "src" / name, name)
    upload_site(ftp, project / "backend" / "src" / "voice.php", project / "backend" / "src" / "account.php", project / "backend" / "src" / "servers.php", project / "backend" / "src" / "chat.php")
    try:
        ftp.retrbinary("RETR .htaccess", lambda _: None)
    except ftplib.error_perm as error:
        if not str(error).startswith("550 "):
            raise
        upload(ftp, project / "backend" / "src" / "hostgator.htaccess", ".htaccess")
    try:
        ftp.cwd(alias_target)
    except ftplib.error_perm as error:
        if not str(error).startswith("550 "):
            raise
        ftp.mkd(alias_target)
        ftp.cwd(alias_target)
    if ftp.pwd().rstrip("/") != alias_target:
        raise RuntimeError("Pasta alternativa inesperada.")
    alias_voice = project / "backend" / "src" / "voice-alias.php"
    if list_files(ftp):
        current = BytesIO()
        ftp.retrbinary("RETR voice.php", current.write)
        if current.getvalue() != alias_voice.read_bytes():
            raise RuntimeError("A pasta alternativa contém arquivos de outro site.")
    existing_rules = BytesIO()
    try:
        ftp.retrbinary("RETR .htaccess", existing_rules.write)
    except ftplib.error_perm as error:
        if not str(error).startswith("550 "):
            raise
    current_rules = existing_rules.getvalue()
    other_rules = re.sub(
        rb"(?m)^# BEGIN Discordo canonical address\r?\n[\s\S]*?^# END Discordo canonical address\r?\n?",
        b"", current_rules,
    )
    redirect = (project / "backend" / "src" / "hostgator-alias.htaccess").read_bytes().rstrip() + b"\n"
    desired_rules = redirect + other_rules
    if desired_rules != current_rules:
        upload_bytes(ftp, BytesIO(desired_rules), ".htaccess")
print(f"Publicado em https://{domain}/ com redirecionamento do endereço anterior.")
