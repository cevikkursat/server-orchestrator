# Panel simgeleri (provenance)

Hepsi tek kaynaktan üretilir; elle çizilmiş raster yoktur.

| Dosya | Kaynak | Boyut |
|---|---|---|
| favicon.svg | elle yazılmış SVG ("Raf yıldızı": üç sunucu katı, üst katın ışığı amber) | vektör |
| icon-maskable.svg | favicon.svg, tam kare zemin + %78 güvenli alan | vektör |
| favicon-16.png, favicon-32.png, icon-192.png, icon-512.png | favicon.svg | 16, 32, 192, 512 |
| apple-touch-icon.png, icon-maskable-512.png | icon-maskable.svg | 180, 512 |

PNG'ler headless Chrome ile SVG'den şeffaf zeminde ekran görüntüsü alınarak üretildi.
SVG değişirse PNG'leri aynı yolla yeniden üretin.
