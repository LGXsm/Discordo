<?php
declare(strict_types=1);

const SESSION_COOKIE = 'discordo_session';

function verifiedSessionTokenHash(string $token): string
{
    // Sessões emitidas antes desta versão usavam o hash do token sem o prefixo.
    return hash('sha256', "discordo:email-verified:v1\0" . $token, true);
}

function query(PDO $db, string $sql, array $parameters = []): PDOStatement
{
    $statement = $db->prepare($sql);
    $statement->execute($parameters);
    return $statement;
}

function databaseConfig(): array
{
    $configFile = getenv('DISCORDO_DB_CONFIG') ?: dirname(__DIR__, 2) . '/.discordo-db.php';
    if (!is_file($configFile)) {
        throw new RuntimeException('Configuração do banco ausente.');
    }
    return require $configFile;
}

function database(): PDO
{
    $config = databaseConfig();
    return new PDO(
        'mysql:host=' . $config['host'] . ';port=' . ($config['port'] ?? 3306)
            . ';dbname=' . $config['database'] . ';charset=utf8mb4',
        $config['user'],
        $config['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
}

function sessionHash(): ?string
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    return is_string($token) && preg_match('/\A[a-f0-9]{64}\z/', $token)
        ? verifiedSessionTokenHash($token) : null;
}

function signedInUser(PDO $db): ?int
{
    $hash = sessionHash();
    if ($hash === null) return null;
    $id = query($db, 'SELECT Usuario_usr_id FROM Sessao WHERE ses_token_hash = ?', [$hash])->fetchColumn();
    return $id === false ? null : (int) $id;
}

function joinEntrance(PDO $db, int $user): void
{
    query($db, 'INSERT INTO MembroServidor (Servidor_srv_id, Usuario_usr_id)
        SELECT srv_id, ? FROM Servidor WHERE srv_entrada = 1
        ON DUPLICATE KEY UPDATE mbs_id = mbs_id', [$user]);
}
