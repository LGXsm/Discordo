# Sons da sala

Adicione `entrou.ogg`, `saiu.ogg`, `voce-entrou.ogg`, `voce-saiu.ogg` e `transmitiu.ogg` a esta pasta, com cópias em MP3 de mesmo nome. Cada arquivo deve durar até 1,5 segundo e ter até 200 KB. O build inclui os arquivos presentes. Enquanto nenhum arquivo estiver disponível, o Discordo gera os sons com Web Audio.

O perfil usa o codificador MP3 [lamejs 1.2.7](https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c), distribuído sob LGPL 3.0. O navegador carrega o codificador ao preparar um som para salvar.
