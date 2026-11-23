# Duas versões do sopro na diagonal inferior

Abra index.html para comparar as duas versões lado a lado, com replay conjunto. Cada prévia permite ajustar largura e bio. Em telas estreitas, as versões aparecem uma abaixo da outra.

## Movimento compartilhado

O sopro sai do ponto de 77% da largura e 60% da altura do avatar real e segue em direção à quina inferior direita do cartão. A velocidade inicial equivale a 45% da versão anterior. Ao tocar a borda, a fumaça se divide em correntes para a esquerda e para cima, pressionada pelos novos tufos e pela expansão dos volumes. A duração continua sendo cinco segundos.

| Tempo | Ação |
| --- | --- |
| 0,00–1,40 s | Crescimento gradual da corrente na diagonal inferior. |
| 1,40–2,30 s | Contato, compressão e divisão pelas bordas inferior e direita. |
| 2,30–3,20 s | O sopro continua alimentando os volumes que se espalham. |
| 3,20–4,20 s | Os volumes ocupam o restante do cartão. |
| 4,20–5,00 s | Dissipação e revelação do perfil. |

## Diferença entre as versões

A versão em tufos mantém os volumes individuais durante todo o sopro.

Na versão contínua, o envelope dos volumes em movimento forma um único contorno fechado. A faixa de sombra acompanha a corrente e algumas curvas abertas sugerem dobras internas. Os tufos individuais aparecem depois da colisão.

A simulação usa passos fixos de 1/60 s, pressão entre partículas, amortecimento e paredes definidas pelas dimensões reais do cartão. As duas versões compartilham a mesma física. O desenho é feito em Canvas 2D e a reprodução usa GSAP.

A camada é transparente, recortada pelos cantos, acima da moldura e abaixo do botão de fechar. Os cliques atravessam a camada. A preferência de movimento reduzido desativa o efeito.

Para reconstruir, execute node build.mjs. Para verificar direção, velocidade, colisão, preenchimento, mudança do desenho e repetibilidade, execute node --test smoke-physics.test.mjs. A versão contínua também foi verificada no navegador para confirmar uma única silhueta conectada durante o sopro.
