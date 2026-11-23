<?php
declare(strict_types=1);

require_once __DIR__ . '/../backend/src/profile-appearance.php';

$directory = tempnam(sys_get_temp_dir(), 'discordo-appearance-test-');
unlink($directory);
mkdir($directory, 0700);
$previous = getenv('DISCORDO_DB_CONFIG');
putenv('DISCORDO_DB_CONFIG=' . $directory . '/config.php');
try {
    $profile = ['bio' => "Café e jogos\n<3", 'theme' => 'brasa', 'frame' => 'grafite', 'effect' => 'gelo'];
    if (profileAppearance(42) !== null) throw new RuntimeException('A new profile should use the default appearance.');
    saveProfileAppearance(42, $profile);
    if (profileAppearance(42) !== $profile || profileAppearance(43) !== null) {
        throw new RuntimeException('Appearance did not persist independently for each account.');
    }
    foreach ([['bio' => str_repeat('á', 181)], ['frame' => 'custom-css'], ['effect' => []], ['theme' => 'invalid']] as $invalid) {
        try {
            saveProfileAppearance(42, array_replace($profile, $invalid));
            throw new RuntimeException('Invalid appearance was accepted.');
        } catch (DomainException) {
            if (profileAppearance(42) !== $profile) throw new RuntimeException('Invalid data replaced the saved appearance.');
        }
    }
    $reset = ['bio' => '', 'theme' => 'discordo', 'frame' => 'none', 'effect' => 'none'];
    saveProfileAppearance(42, $reset);
    if (profileAppearance(42) !== $reset) throw new RuntimeException('The default appearance could not be restored.');
    foreach (['brasa-fumaca', 'visitante-vidro'] as $effect) {
        $animated = array_replace($reset, ['effect' => $effect]);
        saveProfileAppearance(42, $animated);
        if (profileAppearance(42) !== $animated) throw new RuntimeException('The new effect did not persist.');
    }
    $custom = array_replace($reset, ['theme' => 'personalizado', 'colors' => [
        'mode' => 'gradient', 'primary' => '#5a6b72', 'secondary' => '#24577b', 'direction' => 'diagonal',
    ]]);
    saveProfileAppearance(42, $custom);
    $custom['colors']['primary'] = '#5A6B72';
    $custom['colors']['secondary'] = '#24577B';
    if (profileAppearance(42) !== $custom) throw new RuntimeException('Custom gradient was not saved with normalized colors.');
    foreach ([['primary' => '#ABC'], ['secondary' => 'url(external)'], ['direction' => '50deg']] as $badColor) {
        try {
            saveProfileAppearance(42, array_replace($custom, ['colors' => array_replace($custom['colors'], $badColor)]));
            throw new RuntimeException('Invalid custom color was accepted.');
        } catch (DomainException) {
            if (profileAppearance(42) !== $custom) throw new RuntimeException('Invalid color replaced the saved theme.');
        }
    }

    $metal = array_replace($reset, ['frame' => 'metal']);
    saveProfileAppearance(42, array_replace($metal, ['frameColor' => '#20acf0']));
    if (profileAppearance(42) !== $metal) throw new RuntimeException('Metal must persist without a custom color.');
    $neon = array_replace($reset, ['frame' => 'neon', 'frameColor' => '#20ACF0']);
    saveProfileAppearance(42, array_replace($neon, ['frameColor' => '#20acf0']));
    if (profileAppearance(42) !== $neon) throw new RuntimeException('The custom frame color did not persist in uppercase.');
    foreach ([['frameColor' => 'red'], ['effect' => 'metal']] as $invalidFrame) {
        try {
            saveProfileAppearance(42, array_replace($neon, $invalidFrame));
            throw new RuntimeException('Invalid frame settings were accepted.');
        } catch (DomainException) {
            if (profileAppearance(42) !== $neon) throw new RuntimeException('Invalid settings replaced the saved frame.');
        }
    }

    $chunk = static fn (string $type, string $data) => pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
    $png = "\x89PNG\r\n\x1a\n"
        . $chunk('IHDR', pack('NNCCCCC', 192, 192, 8, 6, 0, 0, 0))
        . $chunk('IDAT', gzcompress(str_repeat("\0", (1 + 192 * 4) * 192)))
        . $chunk('IEND', '');
    $gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    $created = [];
    try {
        $name = saveProfileMedia('avatar', $gif, 'data:image/png;base64,' . base64_encode($png), $created,
            ['width' => 1234, 'height' => 999, 'turns' => 1, 'zoom' => 2, 'x' => -0.5, 'y' => 0]);
        $urls = profileMediaUrls(['avatarPath' => $name]);
        if ($urls['avatarCrop'] !== ['width' => 1, 'height' => 1, 'turns' => 1, 'zoom' => 2, 'x' => -0.5, 'y' => 0]) {
            throw new RuntimeException('GIF crop did not persist with the validated image dimensions.');
        }
        removeProfileMedia($name, true);
        foreach ($created as $path) {
            if (is_file($path)) throw new RuntimeException('Removing the GIF left its crop or thumbnail behind.');
        }
    } finally {
        foreach ($created as $path) {
            if (is_file($path)) unlink($path);
        }
    }
} finally {
    foreach (glob(profileAppearanceDirectory() . '/*') as $file) unlink($file);
    if (is_dir(profileAppearanceDirectory())) rmdir(profileAppearanceDirectory());
    if (is_dir(profileMediaDirectory())) rmdir(profileMediaDirectory());
    rmdir($directory);
    putenv($previous === false ? 'DISCORDO_DB_CONFIG' : 'DISCORDO_DB_CONFIG=' . $previous);
}
echo "Profile appearance storage and validation checks passed\n";
