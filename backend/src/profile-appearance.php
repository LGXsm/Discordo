<?php
declare(strict_types=1);

require_once __DIR__ . '/profile-media.php';

function profileAppearanceDirectory(): string
{
    return profileMediaDirectory() . '/appearance';
}

function validateProfileAppearance(array $input): array
{
    $themes = ['discordo', 'noite', 'ciano', 'brasa', 'mata', 'personalizado'];
    $decorations = ['none', 'neon', 'grafite', 'gelo'];
    $bio = is_string($input['bio'] ?? null) ? trim($input['bio']) : null;
    if ($bio === null || !preg_match('/\A.{0,180}\z/us', $bio)) {
        throw new DomainException('Escreva uma bio de até 180 caracteres.');
    }
    if (!in_array($input['theme'] ?? null, $themes, true)
        || !in_array($input['frame'] ?? null, [...$decorations, 'metal'], true)
        || !in_array($input['effect'] ?? null, [...$decorations, 'brasa-fumaca', 'visitante-vidro'], true)) {
        throw new DomainException('Escolha opções de aparência válidas.');
    }
    $appearance = ['bio' => $bio, 'theme' => $input['theme'], 'frame' => $input['frame'], 'effect' => $input['effect']];
    if (isset($input['frameColor']) && in_array($input['frame'], ['neon', 'grafite'], true)) {
        $color = $input['frameColor'];
        if (!is_string($color) || !preg_match('/\A#[0-9a-f]{6}\z/i', $color)) {
            throw new DomainException('Use uma cor válida para a moldura.');
        }
        $appearance['frameColor'] = strtoupper($color);
    }
    if ($input['theme'] === 'personalizado') {
        $colors = $input['colors'] ?? null;
        if (!is_array($colors) || !in_array($colors['mode'] ?? null, ['solid', 'gradient'], true)) {
            throw new DomainException('Escolha uma cor sólida ou um gradiente.');
        }
        $readHex = static function (mixed $color): string {
            if (!is_string($color) || !preg_match('/\A#[0-9a-f]{6}\z/i', $color)) {
                throw new DomainException('Use um código HEX válido para a cor do cartão.');
            }
            return strtoupper($color);
        };
        $themeColors = ['mode' => $colors['mode'], 'primary' => $readHex($colors['primary'] ?? null)];
        if ($colors['mode'] === 'gradient') {
            if (!in_array($colors['direction'] ?? null, ['vertical', 'horizontal', 'diagonal'], true)) {
                throw new DomainException('Escolha uma direção válida para o gradiente.');
            }
            $themeColors['secondary'] = $readHex($colors['secondary'] ?? null);
            $themeColors['direction'] = $colors['direction'];
        }
        $appearance['colors'] = $themeColors;
    }
    return $appearance;
}

function profileAppearance(int $user): ?array
{
    $path = profileAppearanceDirectory() . '/' . $user . '.json';
    if (!is_file($path)) return null;
    $data = json_decode((string) @file_get_contents($path), true);
    if (!is_array($data)) return null;
    try {
        return validateProfileAppearance($data);
    } catch (DomainException) {
        return null;
    }
}

function saveProfileAppearance(int $user, array $input): array
{
    $appearance = validateProfileAppearance($input);
    $directory = profileAppearanceDirectory();
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Pasta de aparência indisponível.');
    }
    $temporary = tempnam($directory, 'profile-');
    if ($temporary === false) throw new RuntimeException('Falha ao preparar a aparência.');
    try {
        $json = json_encode($appearance, JSON_THROW_ON_ERROR);
        if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, "$directory/$user.json")) {
            throw new RuntimeException('Falha ao salvar a aparência.');
        }
    } finally {
        if (is_file($temporary)) @unlink($temporary);
    }
    return $appearance;
}
